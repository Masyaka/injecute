import { describe, expect, it } from 'vitest';
import { DIContainer } from '../src/index.ts';

const disposable = (name: string, log: string[]) => ({
  name,
  async [Symbol.asyncDispose]() {
    log.push(name);
  },
});

describe('dispose()', () => {
  it('disposes owned singletons in reverse creation order (dependents first)', async () => {
    const log: string[] = [];
    const c = new DIContainer()
      .addSingleton('db', () => disposable('db', log), [])
      .addSingleton('repo', (db) => ({ db, ...disposable('repo', log) }), [
        'db',
      ])
      .addSingleton('app', (repo) => ({ repo, ...disposable('app', log) }), [
        'repo',
      ]);
    c.get('app');
    await c.dispose();
    expect(log).toEqual(['app', 'repo', 'db']);
  });

  it('supports Symbol.dispose, custom disposers and opting out', async () => {
    const log: string[] = [];
    const c = new DIContainer()
      .addSingleton(
        'sync',
        () => ({
          [Symbol.dispose]() {
            log.push('sync');
          },
        }),
        [],
      )
      .addSingleton('custom', () => ({ close: () => log.push('custom') }), {
        dependencies: [],
        dispose: (instance) => instance.close(),
      })
      .addSingleton('kept', () => disposable('kept', log), {
        dependencies: [],
        dispose: false,
      });
    c.get('sync');
    c.get('custom');
    c.get('kept');
    await c.dispose();
    expect(log.sort()).toEqual(['custom', 'sync']);
  });

  it('does not dispose singletons that were never created, nor transients', async () => {
    const log: string[] = [];
    const c = new DIContainer()
      .addSingleton('lazy', () => disposable('lazy', log), [])
      .addTransient('t', () => disposable('t', log), []);
    c.get('t');
    await c.dispose();
    expect(log).toEqual([]);
  });

  it('rejects a dispose option on transients', () => {
    expect(() =>
      new DIContainer().addTransient('t', () => ({}), {
        dependencies: [],
        dispose: () => {},
      } as any),
    ).toThrow(/not supported for transient/);
  });

  it('disposes addInstance values only when asked', async () => {
    const log: string[] = [];
    const c = new DIContainer()
      .addInstance('external', disposable('external', log))
      .addInstance('owned', disposable('owned', log), { dispose: true });
    await c.dispose();
    expect(log).toEqual(['owned']);
  });

  it('disposes instances retired by replace() and reset()', async () => {
    const log: string[] = [];
    let n = 0;
    const c = new DIContainer().addSingleton(
      's',
      () => disposable(`s${++n}`, log),
      [],
    );
    c.get('s');
    c.reset();
    c.get('s');
    c.addSingleton('s', () => disposable('replacement', log), {
      replace: true,
      dependencies: [],
    });
    c.get('s');
    await c.dispose();
    expect(log).toEqual(['replacement', 's2', 's1']);
  });

  it('works with await using, and forks dispose only what they own', async () => {
    const log: string[] = [];
    const app = new DIContainer().addSingleton(
      'shared',
      () => disposable('shared', log),
      [],
    );
    {
      await using scope = app
        .fork()
        .addSingleton('requestScoped', () => disposable('request', log), []);
      scope.get('shared');
      scope.get('requestScoped');
    }
    expect(log).toEqual(['request']);
    await app.dispose();
    expect(log).toEqual(['request', 'shared']);
  });

  it('an isolated fork owns every singleton it created', async () => {
    const log: string[] = [];
    const app = new DIContainer().addSingleton(
      'db',
      () => disposable('db', log),
      [],
    );
    const test = app.fork({ isolated: true });
    test.get('db');
    await test.dispose();
    expect(log).toEqual(['db']);
    app.get('db'); // the app's own instance is separate and still usable
  });

  it('disposes namespace services with their parent', async () => {
    const log: string[] = [];
    const app = new DIContainer()
      .addSingleton('db', () => disposable('db', log), [])
      .namespace('Users', (users) =>
        users.addSingleton(
          'repo',
          (db) => ({ db, ...disposable('repo', log) }),
          ['db'],
        ),
      );
    app.get('Users.repo');
    await app.dispose();
    expect(log).toEqual(['repo', 'db']);
  });

  it('keeps disposing after a failure and rejects with an AggregateError', async () => {
    const log: string[] = [];
    const c = new DIContainer()
      .addSingleton('ok', () => disposable('ok', log), [])
      .addSingleton(
        'broken',
        () => ({
          [Symbol.dispose]() {
            throw new Error('boom');
          },
        }),
        [],
      );
    c.get('ok');
    c.get('broken');
    await expect(c.dispose()).rejects.toBeInstanceOf(AggregateError);
    expect(log).toEqual(['ok']);
  });

  it('marks the container as disposed and is idempotent', async () => {
    const c = new DIContainer().addInstance('a', 1);
    const first = c.dispose();
    expect(c.dispose()).toBe(first);
    await first;
    expect(() => c.get('a')).toThrow(/disposed/);
    expect(() => c.addInstance('b', 2)).toThrow(/disposed/);
    expect(() => c.fork()).toThrow(/disposed/);
  });

  it('emits a dispose event', async () => {
    let emitted = false;
    const c = new DIContainer().addEventListener('dispose', () => {
      emitted = true;
    });
    await c.dispose();
    expect(emitted).toBe(true);
  });
});
