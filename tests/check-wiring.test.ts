import { describe, expect, it } from 'vitest';
import {
  AsyncDIContainer,
  checkWiring,
  collect,
  createTag,
  DIContainer,
  InjecuteError,
  optional,
  WiringError,
} from '../src/index.ts';

const rejection = async (promise: Promise<void>): Promise<WiringError> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof WiringError) return error;
    throw error;
  }
  throw new Error('expected a WiringError');
};

describe('checkWiring()', () => {
  it('resolves when everything is registered and resolves', async () => {
    const app = new DIContainer()
      .addInstance('url', 'postgres://')
      .addSingleton('db', (url) => ({ url }), ['url'])
      .addSingleton('users', (db) => ({ db }), ['db']);
    await expect(checkWiring(app)).resolves.toBeUndefined();
    await expect(checkWiring(app, { resolve: true })).resolves.toBeUndefined();
  });

  describe('missing keys (nothing is resolved)', () => {
    it('reports a dependency key nothing registers, with every service that needs it', async () => {
      let created = 0;
      const app = new DIContainer()
        .addSingleton(
          'notifications',
          (mailer: unknown) => {
            created++;
            return { mailer };
          },
          ['mailer' as never],
        )
        .addSingleton('digest', (n) => n, ['notifications'])
        .addInstance('unrelated', 1);
      const error = await rejection(checkWiring(app));
      expect(error).toBeInstanceOf(InjecuteError);
      expect(error.code).toBe('INJECUTE_WIRING_FAILED');
      expect(error.problems).toEqual([
        {
          type: 'missing',
          key: 'mailer',
          affected: ['notifications', 'digest'],
        },
      ]);
      expect(error.message).toContain(
        '"mailer" is not registered. Needed by "notifications", "digest".',
      );
      expect(created).toBe(0);
    });

    it('reports keys listed in keys that nothing registers', async () => {
      const app = new DIContainer().addInstance('clock', 1);
      const error = await rejection(
        checkWiring(app, { keys: ['clock', 'greeter' as never] }),
      );
      expect(error.problems).toEqual([
        { type: 'missing', key: 'greeter', affected: [] },
      ]);
      expect(error.message).toContain(
        '"greeter" is not registered, but it is listed in keys.',
      );
    });

    it('looks up dependencies of namespace services in the namespace first', async () => {
      const app = new DIContainer()
        .addInstance('db', 'db')
        .namespace('Billing', (billing) =>
          billing
            .addInstance('repo', 'repo')
            .addSingleton('invoices', (repo, db) => [repo, db], ['repo', 'db'])
            .addSingleton('mailer', (smtp: unknown) => smtp, ['smtp' as never]),
        );
      const error = await rejection(checkWiring(app));
      expect(error.problems).toEqual([
        { type: 'missing', key: 'smtp', affected: ['Billing.mailer'] },
      ]);
    });

    it('accepts missing optional dependencies and empty tags', async () => {
      const route = createTag('route');
      const app = new DIContainer()
        .addSingleton('cache', (c: unknown) => c, [optional('redis' as never)])
        .addSingleton('router', (routes) => routes, [collect(route)]);
      await expect(
        checkWiring(app, { resolve: true }),
      ).resolves.toBeUndefined();
    });

    it('reports an alias to a key nothing registers', async () => {
      const app = new DIContainer().addAlias('logger', 'jsonLogger' as never);
      const error = await rejection(checkWiring(app));
      expect(error.problems).toEqual([
        { type: 'missing', key: 'jsonLogger', affected: ['logger'] },
      ]);
    });

    it("checks what a fork sees, including its parents' services", async () => {
      const app = new DIContainer().addInstance('db', 'db');
      const scope = app
        .fork()
        .addSingleton('tx', (db) => db, ['db'])
        .addSingleton('report', (tx: unknown) => tx, ['missingTx' as never]);
      const error = await rejection(checkWiring(scope));
      expect(error.problems.map((p) => p.key)).toEqual(['missingTx']);
    });
  });

  describe('resolve: true', () => {
    it('reports a failing service once, with the services it blocks, and runs its factory once', async () => {
      let calls = 0;
      const app = new DIContainer()
        .addSingleton('db', (): { query(): void } => {
          calls++;
          throw new Error('no connection');
        })
        .addSingleton('users', (db) => ({ db }), ['db'])
        .addSingleton('orders', (db) => ({ db }), ['db'])
        .addSingleton('reports', (users) => users, ['users'])
        .addInstance('config', 1);
      const error = await rejection(checkWiring(app, { resolve: true }));
      expect(error.problems).toHaveLength(1);
      expect(error.problems[0]).toMatchObject({
        type: 'failed',
        key: 'db',
        affected: ['users', 'orders', 'reports'],
      });
      expect(error.problems[0]!.error).toMatchObject({
        code: 'INJECUTE_RESOLUTION_FAILED',
      });
      expect(error.message).toContain(
        '"db" failed: no connection. Not resolved because of it: "users", "orders", "reports".',
      );
      expect(error.cause).toBeInstanceOf(AggregateError);
      expect((error.cause as AggregateError).errors).toEqual([
        error.problems[0]!.error,
      ]);
      expect(calls).toBe(1);
    });

    it('lists missing keys first, then failures, and skips services that need a missing key', async () => {
      let created = 0;
      const app = new DIContainer()
        .addSingleton('mailer', (smtp: unknown) => smtp, ['smtp' as never])
        .addSingleton(
          'notifications',
          (m) => {
            created++;
            return m;
          },
          ['mailer'],
        )
        .addSingleton('cache', (): unknown => {
          throw new Error('redis is down');
        });
      const error = await rejection(checkWiring(app, { resolve: true }));
      expect(error.problems.map((p) => [p.type, p.key])).toEqual([
        ['missing', 'smtp'],
        ['failed', 'cache'],
      ]);
      expect(error.message).toContain('The wiring check found 2 problems:');
      expect(created).toBe(0);
    });

    it('reports a service that resolves a failed one by hand under that one', async () => {
      const app = new DIContainer().addSingleton('db', (): unknown => {
        throw new Error('no connection');
      });
      const withLookup = app.addSingleton('lazy', () => app.get('db'));
      const error = await rejection(checkWiring(withLookup, { resolve: true }));
      expect(error.problems).toEqual([
        expect.objectContaining({ key: 'db', affected: ['lazy'] }),
      ]);
    });

    it('follows tags: a failing contribution blocks the collector', async () => {
      const route = createTag('route').of<string>();
      const app = new DIContainer()
        .addSingleton(route('home'), (): string => {
          throw new Error('bad route');
        })
        .addSingleton('router', (routes) => routes, [collect(route)]);
      const error = await rejection(checkWiring(app, { resolve: true }));
      expect(error.problems).toEqual([
        expect.objectContaining({ key: 'home:route', affected: ['router'] }),
      ]);
    });

    it('awaits async services', async () => {
      const app = new AsyncDIContainer()
        .addSingleton('config', async (): Promise<{ port: number }> => {
          throw new Error('bad config');
        })
        .addSingleton('server', (config) => config.port, ['config']);
      const error = await rejection(checkWiring(app, { resolve: true }));
      expect(error.problems).toEqual([
        expect.objectContaining({
          type: 'failed',
          key: 'config',
          affected: ['server'],
        }),
      ]);
      expect(error.message).toContain('"config" failed: bad config.');
    });
  });
});
