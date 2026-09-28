import { describe, expect, it } from 'vitest';
import {
  AsyncDIContainer,
  DIContainer,
  InjecuteError,
  setCacheInstance,
} from '../src/index.ts';

const sealedError = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(InjecuteError);
    expect((error as InjecuteError).code).toBe('INJECUTE_SEALED');
    return error as InjecuteError;
  }
  throw new Error('expected INJECUTE_SEALED');
};

const build = () =>
  new DIContainer()
    .addInstance('url', 'postgres://')
    .addSingleton('db', (url) => ({ url }), ['url'])
    .namespace('Billing', (b) =>
      b.addSingleton('invoices', (db) => [db], ['db']),
    );

describe('seal()', () => {
  it('returns the same container, which still resolves', () => {
    const container = build();
    const app = container.seal();
    expect(app).toBe(container);
    expect(app.get('db')).toEqual({ url: 'postgres://' });
    expect(app.get('Billing.invoices')).toEqual([{ url: 'postgres://' }]);
    expect(app.get('Billing').get('invoices')).toBe(
      app.get('Billing.invoices'),
    );
  });

  it('rejects every registration', () => {
    const app = build().seal() as unknown as DIContainer<any>;
    const error = sealedError(() => app.addInstance('x', 1));
    expect(error.message.split('\n')[0]).toBe(
      '"x" cannot be registered: the container is sealed.',
    );
    expect(error.message).toMatch(/register them in a fork/);
    sealedError(() => app.addSingleton('x', () => 1));
    sealedError(() => app.addTransient('x', () => 1));
    sealedError(() => app.addAlias('x', 'db'));
    sealedError(() => app.addInstance('url', 'other', { replace: true }));
    sealedError(() => app.namespace('Other', (o) => o.addInstance('y', 1)));
    sealedError(() => app.extend((c) => c));
    expect(app.has('x')).toBe(false);
    expect(app.has('Other')).toBe(false);
  });

  it('keeps middlewares, events, reset, overrides and dispose working', async () => {
    const app = build().seal();
    const seen: unknown[] = [];
    app.use((key, next) => {
      seen.push(key);
      return next();
    });
    app.addEventListener('produce', ({ key }) =>
      seen.push(`produced ${String(key)}`),
    );
    const db = app.get('db');
    expect(seen).toEqual(['db', 'url', 'produced db']);
    app.reset({ keys: ['db'] });
    expect(app.get('db')).not.toBe(db);
    setCacheInstance(app, 'url', 'mysql://');
    expect(app.get('url')).toBe('mysql://');
    await app.dispose();
    expect(() => app.get('db')).toThrow(/disposed/);
  });

  it('leaves forks open for registrations', () => {
    const app = build().seal();
    const scope = app.fork().addInstance('requestId', 'req-1');
    expect(scope.get('requestId')).toBe('req-1');
    expect(scope.get('db')).toBe(app.get('db'));
    expect(() => app.get('requestId' as never)).toThrow(/requestId/);
  });

  it('lets isolated forks override services and re-create namespaces', () => {
    const app = build().seal();
    const test = app
      .fork({ isolated: true })
      .addInstance('url', 'postgres://test', { replace: true });
    expect(test.get('Billing.invoices')).toEqual([{ url: 'postgres://test' }]);
    expect(app.get('Billing.invoices')).toEqual([{ url: 'postgres://' }]);
  });

  it('cannot seal a disposed container', async () => {
    const container = build();
    await container.dispose();
    expect(() => container.seal()).toThrow(/disposed/);
  });

  it('seals async containers too; their forks stay async and open', async () => {
    const app = new AsyncDIContainer()
      .addSingleton('config', async () => ({ port: 1 }))
      .seal();
    expect(await app.get('config')).toEqual({ port: 1 });
    sealedError(() =>
      (app as unknown as AsyncDIContainer<any>).addInstance('x', 1),
    );
    const scope = app.fork().addInstance('requestId', Promise.resolve('r'));
    expect(scope).toBeInstanceOf(AsyncDIContainer);
    expect(await scope.get('requestId')).toBe('r');
  });
});
