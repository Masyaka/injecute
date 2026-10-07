// An extension point with a tag: the HTTP module collects every route, without knowing which modules
// contribute them. The Graph tab shows the router's dependencies.
import {
  collect,
  createTag,
  DIContainer,
  type ServiceRegistry,
} from 'injecute';

// #region tags
interface Route {
  readonly method: 'GET' | 'POST';
  readonly path: string;
  handle(): string;
}

/** The extension point: modules register routes under it, the router collects them. */
export const route = createTag('route').of<Route>();

class Router {
  constructor(private readonly routes: Route[]) {}
  handle(method: string, path: string): string {
    const match = this.routes.find(
      (r) => r.method === method && r.path === path,
    );
    return match ? match.handle() : '404';
  }
  list(): string[] {
    return this.routes.map((r) => `${r.method} ${r.path}`);
  }
}

// The owner depends on every route, whoever registers them.
const addHttp = (c: ServiceRegistry) =>
  c.addSingleton('router', Router, [collect(route)]); // Router receives Route[]
// #endregion tags

// #region contribute
class OrderService {
  list(): string {
    return 'orders: 2';
  }
}

// A module contributes under the tag: route('list') is the key 'list:route'.
const addOrders = (c: ServiceRegistry) =>
  c.addSingleton('service', OrderService).addSingleton(
    route('list'),
    (orders): Route => ({
      method: 'GET',
      path: '/orders',
      handle: () => orders.list(),
    }),
    ['service'],
  );

const addHealth = (c: ServiceRegistry) =>
  c.addSingleton(route('health'), (): Route => ({
    method: 'GET',
    path: '/health',
    handle: () => 'ok',
  }));

export const app = new DIContainer()
  .extend(addHttp)
  .namespace('Orders', addOrders) // its route is 'Orders.list:route'
  .extend(addHealth)
  .seal();

export const routes = app.get('router').list(); // ['GET /orders', 'GET /health']
export const response = app.get('router').handle('GET', '/orders');
// #endregion contribute

// #region testing
// An isolated fork collects its own replacements and additions.
export const testRoutes = app
  .fork({ isolated: true })
  .addSingleton(
    route('health'),
    (): Route => ({ method: 'GET', path: '/health', handle: () => 'fake' }),
    { replace: true },
  )
  .addSingleton(route('debug'), (): Route => ({
    method: 'GET',
    path: '/debug',
    handle: () => 'debug',
  }))
  .get('router')
  .list(); // ['GET /orders', 'GET /health', 'GET /debug']
// #endregion testing

console.log(routes, response, testRoutes);

export default app;
