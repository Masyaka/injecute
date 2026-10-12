import { describe, expect, it } from 'vitest';
import { DIContainer } from '../src/index.ts';

class Repo {
  constructor(readonly db: string) {}
}

const createApp = () =>
  new DIContainer()
    .addInstance('db', 'realDb')
    .addSingleton('repo', Repo, ['db'])
    .addTransient('report', (repo) => `report(${repo.db})`, ['repo']);

describe('fork({ isolated: true })', () => {
  it('a normal fork shares parent singletons, so overrides do not reach them', () => {
    const app = createApp();
    const fork = app.fork().addInstance('db', 'mockDb', { replace: true });
    expect(fork.get('repo').db).toBe('realDb');
    expect(fork.get('repo')).toBe(app.get('repo'));
  });

  it('an isolated fork runs parent-registered factories itself, so overrides reach the whole graph', () => {
    const app = createApp();
    const test = app
      .fork({ isolated: true })
      .addInstance('db', 'mockDb', { replace: true });
    expect(test.get('repo').db).toBe('mockDb');
    expect(test.get('report')).toBe('report(mockDb)');
    // singletons are singletons inside the fork
    expect(test.get('repo')).toBe(test.get('repo'));
  });

  it('nothing leaks back into the parent', () => {
    const app = createApp();
    const realRepo = app.get('repo');
    const test = app
      .fork({ isolated: true })
      .addInstance('db', 'mockDb', { replace: true });
    expect(test.get('repo')).not.toBe(realRepo);
    expect(app.get('repo')).toBe(realRepo);
    expect(app.get('repo').db).toBe('realDb');
  });

  it('sees registrations added to the parent later', () => {
    const app = createApp();
    const test = app.fork({ isolated: true });
    app.addInstance('late', 42);
    // the fork's type was fixed when it was created; the registration is visible at runtime
    expect(test.get('late' as never)).toBe(42);
  });

  it('forks of an isolated fork share its instances', () => {
    const app = createApp();
    const test = app.fork({ isolated: true });
    expect(test.fork().get('repo')).toBe(test.get('repo'));
    expect(test.fork().get('repo')).not.toBe(app.get('repo'));
  });

  it('re-creates namespaces inside the isolated fork', () => {
    const app = new DIContainer()
      .addInstance('db', 'realDb')
      .namespace('Users', (users) => users.addSingleton('repo', Repo, ['db']));
    const test = app
      .fork({ isolated: true })
      .addInstance('db', 'mockDb', { replace: true });
    expect(test.get('Users.repo').db).toBe('mockDb');
    expect(test.get('Users').get('repo').db).toBe('mockDb');
    expect(app.get('Users.repo').db).toBe('realDb');
  });

  it('keeps decorations registered in the parent', () => {
    const app = new DIContainer()
      .addInstance('log', 'L')
      .fork()
      .addSingleton('log', (log) => `wrapped(${log})`, ['log']);
    const test = app.fork({ isolated: true });
    expect(test.get('log')).toBe('wrapped(L)');
  });

  it('inherits middlewares', () => {
    const seen: unknown[] = [];
    const app = createApp();
    app.use((key, next) => {
      seen.push(key);
      return next();
    });
    app.fork({ isolated: true }).get('db');
    expect(seen).toEqual(['db']);
  });
});
