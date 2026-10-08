import { describe, expect, it } from 'vitest';
import { DIContainer, type Middleware } from '../src/index.ts';

const recorder = () => {
  const seen: string[] = [];
  const middleware: Middleware = (key, next) => {
    seen.push(String(key));
    return next();
  };
  return { seen, middleware };
};

describe('middlewares', () => {
  it('runs once per get(), not once per container level', () => {
    const { seen, middleware } = recorder();
    const root = new DIContainer().use(middleware).addInstance('a', 1);
    root.fork().fork().get('a');
    expect(seen).toEqual(['a']);
  });

  it('forks inherit middlewares live: added to the parent after fork() still applies', () => {
    const { seen, middleware } = recorder();
    const root = new DIContainer().addInstance('a', 1);
    const child = root.fork();
    root.use(middleware);
    child.get('a');
    expect(seen).toEqual(['a']);
  });

  it('fork({ middlewares: false }) does not inherit', () => {
    const { seen, middleware } = recorder();
    const root = new DIContainer().use(middleware).addInstance('a', 1);
    root.fork({ middlewares: false }).get('a');
    expect(seen).toEqual([]);
  });

  it('unuse() removes a middleware', () => {
    const { seen, middleware } = recorder();
    const c = new DIContainer().use(middleware).addInstance('a', 1);
    c.get('a');
    c.unuse(middleware);
    c.get('a');
    expect(seen).toEqual(['a']);
  });

  it('runs the last added middleware first, own after inherited', () => {
    const order: string[] = [];
    const tag =
      (name: string): Middleware =>
      (_key, next) => {
        order.push(name);
        return next();
      };
    const root = new DIContainer().use(tag('root1')).use(tag('root2'));
    const child = root.fork().use(tag('child')).addInstance('a', 1);
    child.get('a');
    expect(order).toEqual(['child', 'root2', 'root1']);
  });

  it('sees nested dependencies with their resolution path', () => {
    const paths: string[] = [];
    const c = new DIContainer()
      .use((_key, next, { path, depth }) => {
        paths.push(`${depth}:${path.join('>')}`);
        return next();
      })
      .addInstance('config', { url: 'x' })
      .addSingleton('db', (config) => ({ config }), ['config']);
    c.get('db');
    expect(paths).toEqual(['0:db', '1:db>config']);
  });

  it('next(otherKey) redirects the resolution', () => {
    const c = new DIContainer()
      .use((key, next) => (key === 'oldName' ? next('newName') : next()))
      .addInstance('newName', 'value');
    expect(c.get('oldName' as never)).toBe('value');
  });

  it('can provide values for keys that are not registered', () => {
    const c = new DIContainer().use((key, next) =>
      typeof key === 'string' && key.startsWith('env.')
        ? `from-env:${key.slice(4)}`
        : next(),
    );
    expect(c.get('env.PORT' as never)).toBe('from-env:PORT');
  });

  it('works with arrow functions and exposes the container on the context', () => {
    let seenContainer: unknown;
    const c = new DIContainer().addInstance('a', 1);
    c.use((_key, next, { container }) => {
      seenContainer = container;
      return next();
    });
    c.get('a');
    expect(seenContainer).toBe(c);
  });

  it('child middlewares do not intercept dependencies of parent-owned singletons', () => {
    const { seen, middleware } = recorder();
    const root = new DIContainer()
      .addInstance('config', 1)
      .addSingleton('db', (config) => ({ config }), ['config']);
    const child = root.fork().use(middleware);
    child.get('db');
    // `db` runs in the root (it is cached there and shared), so its dependency is resolved there too.
    expect(seen).toEqual(['db']);
  });
});
