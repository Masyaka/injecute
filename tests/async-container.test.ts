import { describe, expect, it } from 'vitest';
import {
  AsyncDIContainer,
  buildServicesGraph,
  DIContainer,
  InjecuteError,
  optional,
  type AsyncServiceRegistry,
  type Middleware,
} from '../src/index.ts';

const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

class Database {
  constructor(readonly url: string) {}
}
class Repo {
  constructor(readonly db: Database) {}
}

const disposable = (name: string, log: string[]) => ({
  name,
  async [Symbol.asyncDispose]() {
    log.push(name);
  },
});

describe('AsyncDIContainer', () => {
  it('awaits dependencies, so factories and classes receive resolved values', async () => {
    const app = new AsyncDIContainer()
      .addSingleton('url', async () => {
        await tick();
        return 'postgres://';
      })
      .addSingleton('db', Database, ['url'])
      .addSingleton('repo', Repo, ['db'])
      .addTransient('summary', (repo, url) => `${repo.db.url} ${url}`, [
        'repo',
        'url',
      ]);
    const repo = await app.get('repo');
    expect(repo).toBeInstanceOf(Repo);
    expect(repo.db).toBeInstanceOf(Database);
    expect(repo.db.url).toBe('postgres://');
    expect(await app.get('summary')).toBe('postgres:// postgres://');
  });

  it('returns a promise from get() for every kind of registration', async () => {
    const app = new AsyncDIContainer()
      .addInstance('n', 1)
      .addInstance('p', Promise.resolve(2))
      .addAlias('m', 'n')
      .addSingleton('s', (n, p) => n + p, ['n', 'p']);
    for (const key of ['n', 'p', 'm', 's'] as const) {
      expect(app.get(key)).toBeInstanceOf(Promise);
    }
    expect(
      await Promise.all([app.get('n'), app.get('p'), app.get('m')]),
    ).toEqual([1, 2, 1]);
    expect(await app.get('s')).toBe(3);
  });

  it('rejects instead of throwing when a key is not registered', async () => {
    const app = new AsyncDIContainer().addSingleton('a', () => 1);
    const result = app.get('missing' as never);
    expect(result).toBeInstanceOf(Promise);
    await expect(result).rejects.toMatchObject({
      code: 'INJECUTE_NOT_REGISTERED',
    });
    await expect(
      app.get('missing' as never, { optional: true }),
    ).resolves.toBeUndefined();
  });

  it('resolves optional dependencies', async () => {
    const app = new AsyncDIContainer()
      .addInstance('present', Promise.resolve('here'))
      .addSingleton('both', (a, b) => [a, b], [
        optional('present'),
        optional('absent'),
      ]);
    expect(await app.get('both')).toEqual(['here', undefined]);
  });

  it('creates a singleton once under concurrent resolutions', async () => {
    let calls = 0;
    const app = new AsyncDIContainer().addSingleton('db', async () => {
      calls++;
      await tick();
      return new Database('x');
    });
    const [a, b] = await Promise.all([app.get('db'), app.get('db')]);
    expect(a).toBe(b);
    expect(calls).toBe(1);
  });

  it('retries a failed singleton and wraps the failure with the path', async () => {
    let calls = 0;
    const cause = new Error('connection refused');
    const app = new AsyncDIContainer()
      .addSingleton('db', async () => {
        if (++calls === 1) throw cause;
        return new Database('x');
      })
      .addSingleton('repo', Repo, ['db']);
    const error = await app.get('repo').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InjecuteError);
    expect(error).toMatchObject({
      code: 'INJECUTE_RESOLUTION_FAILED',
      path: ['repo', 'db'],
      cause,
    });
    expect(await app.get('repo')).toBeInstanceOf(Repo);
    expect(calls).toBe(2);
  });

  it('wraps a factory that throws synchronously', async () => {
    const app = new AsyncDIContainer().addSingleton('boom', () => {
      throw new Error('boom');
    });
    await expect(app.get('boom')).rejects.toMatchObject({
      code: 'INJECUTE_RESOLUTION_FAILED',
      path: ['boom'],
    });
  });

  it('call() awaits the function service', async () => {
    const app = new AsyncDIContainer()
      .addSingleton('greet', async () => (name: string) => `hi ${name}`)
      .addInstance('value', 1);
    expect(await app.call('greet', ['Ada'])).toBe('hi Ada');
    await expect(app.call('value' as never, [] as never)).rejects.toMatchObject(
      { code: 'INJECUTE_NOT_A_FUNCTION' },
    );
  });

  it('injecute(), bind() and createResolver() return promises', async () => {
    const app = new AsyncDIContainer().addSingleton(
      'url',
      async () => 'postgres://',
    );
    expect(await app.injecute(Database, ['url'])).toBeInstanceOf(Database);
    expect(await app.bind(['url'], (url) => url.length)()).toBe(11);
    expect(await app.createResolver('url')()).toBe('postgres://');
    await expect(
      app.injecute((x: unknown) => x, ['missing' as never]),
    ).rejects.toMatchObject({ code: 'INJECUTE_NOT_REGISTERED' });
  });

  it('keeps forks async, including isolated forks with overrides', async () => {
    const app = new AsyncDIContainer()
      .addSingleton('url', async () => 'real')
      .addSingleton('db', Database, ['url']);
    const scope = app.fork().addSingleton('repo', Repo, ['db']);
    expect(scope).toBeInstanceOf(AsyncDIContainer);
    expect((await scope.get('repo')).db).toBe(await app.get('db'));

    const test = app
      .fork({ isolated: true })
      .addInstance('url', Promise.resolve('fake'), { replace: true });
    expect((await test.get('db')).url).toBe('fake');
    expect((await app.get('db')).url).toBe('real');
  });

  it('decorates a parent service with a self-dependency', async () => {
    const app = new AsyncDIContainer().addSingleton(
      'greeting',
      async () => 'hello',
    );
    const child = app
      .fork()
      .addSingleton('greeting', (previous) => `${previous}!`, ['greeting']);
    expect(await child.get('greeting')).toBe('hello!');
  });

  it('applies async modules and namespaces', async () => {
    const addRepo = (c: AsyncServiceRegistry<{ db: Database }>) =>
      c.addSingleton('repo', Repo, ['db']);
    const app = new AsyncDIContainer()
      .addSingleton('db', async () => new Database('x'))
      .extend(addRepo)
      .namespace('Billing', (billing) =>
        billing.addSingleton('invoices', async (repo) => ({ repo }), ['repo']),
      );
    expect(await app.get('repo')).toBeInstanceOf(Repo);
    expect((await app.get('Billing.invoices')).repo).toBe(
      await app.get('repo'),
    );
    const billing = await app.get('Billing');
    expect(await billing.get('invoices')).toBe(
      await app.get('Billing.invoices'),
    );
  });

  it('disposes resolved singletons, dependents first, and supports await using', async () => {
    const log: string[] = [];
    {
      await using app = new AsyncDIContainer()
        .addSingleton('db', async () => disposable('db', log))
        .addSingleton('repo', (db) => ({ db, ...disposable('repo', log) }), [
          'db',
        ]);
      await app.get('repo');
    }
    expect(log).toEqual(['repo', 'db']);
  });

  it('rejects resolutions after dispose', async () => {
    const app = new AsyncDIContainer().addSingleton('a', () => 1);
    await app.dispose();
    await expect(app.get('a')).rejects.toMatchObject({
      code: 'INJECUTE_DISPOSED',
    });
  });

  it('runs middlewares; next() returns a promise for created services', async () => {
    const seen: unknown[] = [];
    const middleware: Middleware = (key, next) => {
      const value = next();
      seen.push(value instanceof Promise);
      return value;
    };
    const app = new AsyncDIContainer()
      .use(middleware)
      .addSingleton('a', async () => 1);
    expect(await app.get('a')).toBe(1);
    expect(seen).toEqual([true]);
  });

  it('works with buildServicesGraph()', () => {
    const app = new AsyncDIContainer()
      .addSingleton('url', async () => 'x')
      .addSingleton('db', Database, ['url']);
    const graph = buildServicesGraph(app);
    expect(Object.keys(graph.db?.dependencies ?? {})).toEqual(['url']);
  });

  it('is a DIContainer subclass at runtime, but a different type', () => {
    const app = new AsyncDIContainer();
    expect(app).toBeInstanceOf(AsyncDIContainer);
    expect(app).toBeInstanceOf(DIContainer);
    expect(new DIContainer()).not.toBeInstanceOf(AsyncDIContainer);
  });
});
