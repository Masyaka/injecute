import { describe, expect, it } from 'vitest';
import {
  AsyncDIContainer,
  collect,
  createTag,
  DIContainer,
  InjecuteError,
  type ServiceRegistry,
} from '../src/index.ts';

const thrown = (fn: () => unknown): InjecuteError => {
  try {
    fn();
  } catch (error) {
    if (error instanceof InjecuteError) return error;
    throw error;
  }
  throw new Error('expected an InjecuteError');
};

let nextId = 0;
class Db {
  begin() {
    return { id: ++nextId };
  }
}

const createApp = () =>
  new DIContainer()
    .addSingleton('db', Db)
    .addSingleton('tx', (db) => db.begin(), ['db'])
    .addSingleton('report', (tx) => ({ tx }), ['tx'])
    .addSingleton('summary', (report) => ({ report }), ['report'])
    .addInstance('unrelated', 1);

describe('overriding a parent key in a fork', () => {
  it('throws INJECUTE_ALREADY_REGISTERED without replace', () => {
    const error = thrown(() =>
      createApp()
        .fork()
        .addSingleton('tx', (db) => db.begin(), ['db']),
    );
    expect(error.code).toBe('INJECUTE_ALREADY_REGISTERED');
    expect(error.message).toContain(
      '"tx" is registered in a parent container. Pass { replace: true } to override it in this fork only',
    );
  });

  it('names the parent services that keep the parent instance, also through other services', () => {
    const error = thrown(() => createApp().fork().addInstance('tx', { id: 0 }));
    expect(error.message).toContain(
      `"report", "summary" (registered in a parent) depend on "tx" and keep the parent's "tx".`,
    );
    expect(error.message).toContain('fork({ isolated: true })');
    expect(error.message).not.toContain('"unrelated"');
  });

  it('uses the singular for one dependent', () => {
    const app = new DIContainer()
      .addInstance('config', { port: 1 })
      .addSingleton('server', (config) => config.port, ['config']);
    const error = thrown(() => app.fork().addInstance('config', { port: 2 }));
    expect(error.message).toContain(
      `"server" (registered in a parent) depends on "config" and keeps the parent's "config". To give it this fork's "config", register it in this fork too`,
    );
  });

  it('gives a short message when nothing in the parent depends on the key', () => {
    const error = thrown(() => createApp().fork().addInstance('unrelated', 2));
    expect(error.message).toMatch(
      /"unrelated" is registered in a parent container\. Pass \{ replace: true \} to override it in this fork only\.$/m,
    );
  });

  it('lists namespace services, tag collectors and aliases that depend on the key', () => {
    const route = createTag('route').of<{ path: string }>();
    const app = new DIContainer()
      .addInstance('base', '/api')
      .addSingleton(route('home'), (base) => ({ path: base }), ['base'])
      .addSingleton('router', (routes) => routes, [collect(route)])
      .addAlias('prefix', 'base')
      .namespace('Billing', (billing) =>
        billing.addSingleton('invoices', (base) => `${base}/invoices`, [
          'base',
        ]),
      );
    const error = thrown(() => app.fork().addInstance('base', '/v2'));
    for (const key of ['home:route', 'router', 'prefix', 'Billing.invoices']) {
      expect(error.message).toContain(`"${key}"`);
    }
  });

  it('does not list services that resolve their own definition of the key', () => {
    const app = new DIContainer()
      .addInstance('base', '/api')
      .namespace('Billing', (billing) =>
        billing
          .addInstance('base', '/billing', { replace: true })
          .addSingleton('invoices', (base) => `${base}/invoices`, ['base']),
      );
    const error = thrown(() => app.fork().addInstance('base', '/v2'));
    expect(error.message).not.toContain('Billing.invoices');
  });

  it('shortens a long list of dependents', () => {
    let app: DIContainer<any> = new DIContainer().addInstance('config', 1);
    for (let i = 1; i <= 7; i++)
      app = app.addSingleton(`s${i}`, (c: number) => c + i, ['config']);
    const error = thrown(() => app.fork().addInstance('config', 2));
    expect(error.message).toContain(
      '"s1", "s2", "s3", "s4", "s5" and 2 more (registered in a parent) depend on "config"',
    );
  });

  it('checks every parent level', () => {
    const scope = createApp().fork().fork();
    expect(thrown(() => scope.addInstance('tx', { id: 0 })).message).toContain(
      '"report", "summary"',
    );
  });

  it('allows the override with replace: true; it reaches only services resolved in the fork', () => {
    const app = createApp();
    const scope = app
      .fork()
      .addSingleton('tx', (db) => db.begin(), {
        dependencies: ['db'],
        replace: true,
      })
      .addSingleton('local', (tx) => ({ tx }), ['tx']);
    expect(scope.get('local').tx).toBe(scope.get('tx'));
    expect(scope.get('report')).toBe(app.get('report'));
    expect(scope.get('report').tx).toBe(app.get('tx'));
    expect(scope.get('tx')).not.toBe(app.get('tx'));
  });

  it('is required in isolated forks too, with a message for them', () => {
    const app = createApp();
    const error = thrown(() =>
      app.fork({ isolated: true }).addInstance('tx', { id: 0 }),
    );
    expect(error.code).toBe('INJECUTE_ALREADY_REGISTERED');
    expect(error.message).toContain(
      'to override it in this isolated fork: every service resolved through the fork uses the replacement',
    );
    const test = app
      .fork({ isolated: true })
      .addInstance('tx', { id: 0 }, { replace: true });
    expect(test.get('report').tx).toEqual({ id: 0 });
  });

  it('applies to modules applied to a fork', () => {
    const addRequest = (c: ServiceRegistry<{ db: Db }>) =>
      c.addSingleton('tx', (db) => db.begin(), ['db']);
    const app = createApp();
    expect(thrown(() => app.fork().extend(addRequest)).message).toContain(
      '"report", "summary"',
    );
    const addRequestReplacing = (c: ServiceRegistry<{ db: Db }>) =>
      c.addSingleton('tx', (db) => db.begin(), {
        dependencies: ['db'],
        replace: true,
      });
    expect(app.fork().extend(addRequestReplacing).get('tx')).not.toBe(
      app.get('tx'),
    );
  });

  it('applies to namespace callbacks, which receive a fork', () => {
    const app = new DIContainer().addInstance('cfg', 'root');
    expect(() =>
      app.namespace('Generic', (generic) => generic.addInstance('cfg', 'own')),
    ).toThrow(/"cfg" is registered in a parent container/);
    const withNamespace = new DIContainer()
      .addInstance('cfg', 'root')
      .namespace('Generic', (generic) =>
        generic.addInstance('cfg', 'own', { replace: true }),
      );
    expect(withNamespace.get('Generic.cfg')).toBe('own');
    expect(withNamespace.get('cfg')).toBe('root');
  });

  it('applies to decoration with a self-dependency', () => {
    const app = new DIContainer().addInstance('log', 'L');
    expect(() =>
      app.fork().addSingleton('log', (log) => `wrapped(${log})`, ['log']),
    ).toThrow(/"log" is registered in a parent container/);
    const scope = app.fork().addSingleton('log', (log) => `wrapped(${log})`, {
      dependencies: ['log'],
      replace: true,
    });
    expect(scope.get('log')).toBe('wrapped(L)');
    expect(app.get('log')).toBe('L');
  });

  it('applies to addAlias, which takes replace too', () => {
    const app = new DIContainer()
      .addInstance('json', 'json')
      .addInstance('pretty', 'pretty')
      .addAlias('logger', 'json');
    expect(() => app.fork().addAlias('logger', 'pretty')).toThrow(
      /"logger" is registered in a parent container/,
    );
    expect(
      app.fork().addAlias('logger', 'pretty', { replace: true }).get('logger'),
    ).toBe('pretty');
    expect(() => app.addAlias('logger', 'pretty')).toThrow(
      /already registered in this container/,
    );
    expect(
      app.addAlias('logger', 'pretty', { replace: true }).get('logger'),
    ).toBe('pretty');
  });

  it('applies to async containers', async () => {
    const app = new AsyncDIContainer()
      .addSingleton('tx', async () => ({ id: 1 }))
      .addSingleton('report', (tx) => ({ tx }), ['tx']);
    expect(
      thrown(() => app.fork().addInstance('tx', { id: 2 })).message,
    ).toContain(`"report" (registered in a parent) depends on "tx"`);
    const scope = app.fork().addInstance('tx', { id: 2 }, { replace: true });
    expect(await scope.get('tx')).toEqual({ id: 2 });
    expect((await scope.get('report')).tx).toEqual({ id: 1 });
  });

  it('still lets a fork register new keys without replace', () => {
    const scope = createApp().fork().addInstance('requestId', 'r1');
    expect(scope.get('requestId')).toBe('r1');
  });
});
