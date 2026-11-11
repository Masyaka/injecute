import { describe, expect, it } from 'vitest';
import {
  AsyncDIContainer,
  buildServicesGraph,
  collect,
  createTag,
  DIContainer,
  InjecuteError,
  type ServiceKey,
} from '../src/index.ts';

interface Route {
  path: string;
}
const route = createTag('route').of<Route>();
const r = (path: string) => (): Route => ({ path });
const paths = (routes: Route[]) => routes.map((x) => x.path);

describe('createTag()', () => {
  it('builds keys and keeps its name', () => {
    expect(route('orders')).toBe('orders:route');
    expect(route.tagName).toBe('route');
    expect(route.of()).toBe(route);
    expect(Object.isFrozen(route)).toBe(true);
  });

  it.each(['', 'a:b', 'a.b'])('rejects the name %j', (name) => {
    expect(() => createTag(name)).toThrow(
      expect.objectContaining({ code: 'INJECUTE_INVALID_OPTION' }),
    );
  });

  it('rejects an empty key name', () => {
    expect(() => route('')).toThrow(/needs a name/);
  });
});

describe('collect()', () => {
  it('collects every service under the tag, also in namespaces, in registration order', () => {
    const app = new DIContainer()
      .addSingleton(route('home'), r('/'))
      .namespace('Orders', (c) => c.addSingleton(route('list'), r('/orders')))
      .addSingleton('router', (routes) => paths(routes), [collect(route)])
      .addSingleton(route('about'), r('/about')) // registered after the collector: still collected
      .addInstance('user:repo', 'not a route');
    expect(app.get('router')).toEqual(['/', '/orders', '/about']);
  });

  it('resolves to an empty array without contributions', () => {
    const app = new DIContainer().addSingleton('router', (routes) => routes, [
      collect(route),
    ]);
    expect(app.get('router')).toEqual([]);
  });

  it('collects once per service in a namespace that sees its own and its linked keys', () => {
    const app = new DIContainer()
      .addSingleton(route('home'), r('/'))
      .namespace('Http', (c) =>
        c
          .addSingleton(route('health'), r('/health'))
          .addSingleton('router', (routes) => paths(routes), [collect(route)]),
      );
    expect(app.get('Http.router')).toEqual(['/', '/health']);
  });

  it('collects once in a namespace resolved from an isolated fork', () => {
    const app = new DIContainer().namespace('Http', (c) =>
      c
        .addSingleton(route('health'), r('/health'))
        .addSingleton('router', (routes) => paths(routes), [collect(route)]),
    );
    expect(app.fork({ isolated: true }).get('Http.router')).toEqual([
      '/health',
    ]);
  });

  it("collects the root's decoration of a namespace contribution, not the original", () => {
    const app = new DIContainer()
      .namespace('Http', (c) =>
        c
          .addSingleton(route('health'), r('/health'))
          .addSingleton('router', (routes) => paths(routes), [collect(route)]),
      )
      .addSingleton(
        'Http.health:route',
        (health): Route => ({ path: `${health.path}!` }),
        { dependencies: ['Http.health:route'], replace: true },
      );
    expect(app.get('Http.router')).toEqual(['/health!']);
  });

  it('collects from nested namespaces once', () => {
    const app = new DIContainer().namespace('Outer', (outer) =>
      outer.namespace('Inner', (inner) =>
        inner
          .addSingleton(route('deep'), r('/deep'))
          .addSingleton('router', (routes) => paths(routes), [collect(route)]),
      ),
    );
    expect(app.get('Outer.Inner.router')).toEqual(['/deep']);
  });

  it('collects in the container that creates the service: an isolated fork sees its replacements and additions', () => {
    const app = new DIContainer()
      .addSingleton(route('home'), r('/'))
      .addSingleton('router', (routes) => paths(routes), [collect(route)])
      .seal();
    const test = app
      .fork({ isolated: true })
      .addSingleton(route('home'), r('/fake'), { replace: true })
      .addSingleton(route('debug'), r('/debug'));
    expect(test.get('router')).toEqual(['/fake', '/debug']);
    expect(app.get('router')).toEqual(['/']);
  });

  it('shares singleton contributions with direct resolution', () => {
    const app = new DIContainer()
      .addSingleton(route('home'), r('/'))
      .addSingleton('router', (routes) => routes, [collect(route)]);
    expect(app.get('router')[0]).toBe(app.get('home:route'));
  });

  it('reports a cycle through a collected service with the path', () => {
    const app = new DIContainer()
      .addSingleton('router', (routes) => routes, [collect(route)])
      .addSingleton(
        route('home'),
        (router): Route => ({ path: `/${router.length}` }),
        ['router'],
      );
    expect(() => app.get('router')).toThrow(
      expect.objectContaining({ code: 'INJECUTE_CIRCULAR_DEPENDENCY' }),
    );
  });

  it('runs collected services through middlewares', () => {
    const seen: ServiceKey[][] = [];
    const app = new DIContainer()
      .namespace('Orders', (c) => c.addSingleton(route('list'), r('/orders')))
      .addSingleton('router', (routes) => routes, [collect(route)])
      .use((key, next, { path }) => {
        seen.push([...path]);
        return next();
      });
    app.get('router');
    expect(seen).toContainEqual(['router', 'Orders.list:route']);
  });

  it('awaits every service in an AsyncDIContainer', async () => {
    const app = new AsyncDIContainer()
      .addSingleton(route('slow'), async () => ({ path: '/slow' }))
      .addSingleton('router', (routes) => paths(routes), [collect(route)]);
    expect(await app.get('router')).toEqual(['/slow']);
  });

  it('describes the dependency in getRegistration() and the services graph', () => {
    const app = new DIContainer()
      .namespace('Orders', (c) => c.addSingleton(route('list'), r('/orders')))
      .addSingleton('router', (routes) => routes, [collect(route)]);
    expect(app.getRegistration('router')?.dependencies).toEqual([
      { type: 'collect', tag: 'route' },
    ]);
    expect(
      Object.keys(buildServicesGraph(app).router?.dependencies ?? {}),
    ).toEqual(['Orders.list:route']);
  });

  it('rejects something that is not a tag', () => {
    expect(() => collect((() => 'x') as never)).toThrow(InjecuteError);
  });
});
