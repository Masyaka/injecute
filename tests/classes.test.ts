import { describe, expect, it } from 'vitest';
import { construct, defer, DIContainer } from '../src/index.ts';

class Logger {
  readonly name = 'logger';
}
class Repo {
  constructor(
    readonly logger: Logger,
    readonly url: string,
  ) {}
}

describe('class registration', () => {
  it('detects classes and constructs them with new', () => {
    const c = new DIContainer()
      .addInstance('url', 'db://')
      .addSingleton('logger', Logger)
      .addTransient('repo', Repo, ['logger', 'url']);
    expect(c.get('repo')).toBeInstanceOf(Repo);
    expect(c.get('repo').logger).toBe(c.get('logger'));
    expect(c.get('repo')).not.toBe(c.get('repo'));
  });

  it('still calls plain, arrow and async functions', async () => {
    function plain(this: unknown) {
      return this;
    }
    const c = new DIContainer()
      .addSingleton('plain', plain)
      .addSingleton('arrow', () => 'arrow')
      .addSingleton('async', async () => 'async');
    expect(c.get('plain')).toBeUndefined();
    expect(c.get('arrow')).toBe('arrow');
    await expect(c.get('async')).resolves.toBe('async');
  });

  it('constructs classes passed to injecute(), bind() and defer()', async () => {
    const c = new DIContainer()
      .addInstance('url', 'db://')
      .addSingleton('logger', Logger);
    expect(c.injecute(Repo, ['logger', 'url'])).toBeInstanceOf(Repo);
    expect(c.bind(['logger', 'url'], Repo)()).toBeInstanceOf(Repo);
    const deferred = defer(Repo);
    await expect(
      deferred(new Logger(), Promise.resolve('x')),
    ).resolves.toBeInstanceOf(Repo);
  });

  it('keeps construct() for explicit registration', () => {
    const c = new DIContainer()
      .addInstance('url', 'db://')
      .addSingleton('logger', Logger)
      .addSingleton('repo', construct(Repo), ['logger', 'url']);
    expect(c.get('repo')).toBeInstanceOf(Repo);
  });

  it('keeps a class registered with addInstance as the class itself', () => {
    const c = new DIContainer().addInstance('RepoClass', Repo);
    expect(c.get('RepoClass')).toBe(Repo);
  });

  it('constructs built-in constructors and proxied classes', () => {
    const c = new DIContainer()
      .addTransient('map', Map)
      .addTransient('proxied', new Proxy(Logger, {}));
    expect(c.get('map')).toBeInstanceOf(Map);
    expect(c.get('proxied')).toBeInstanceOf(Logger);
  });
});
