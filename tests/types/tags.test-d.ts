// Type-level tests for tags, collect() and startable(). Checked by `npm run typecheck` (tsc), not executed.
import { expectTypeOf } from 'vitest';
import {
  collect,
  createTag,
  DIContainer,
  AsyncDIContainer,
  lifecycle,
  optional,
  startable,
  startSignal,
  startLifecycle,
  type ServiceRegistry,
  type LifecycleHook,
  type Tag,
  type TaggedKey,
} from '../../src/index.ts';

interface Route {
  path: string;
}
const route = createTag('route').of<Route>();
expectTypeOf(route).toEqualTypeOf<Tag<Route, 'route'>>();
expectTypeOf(route('orders')).toEqualTypeOf<
  'orders:route' & TaggedKey<Route, 'orders:route'>
>();

// ---- registering under a tag checks the service against the tag's type
class RouteClass implements Route {
  path = '/class';
}
class NotARoute {
  name = 'x';
}
const checked = new DIContainer()
  .addInstance('db', { prefix: '/db' })
  .addSingleton(route('fromDb'), (db) => ({ path: db.prefix }), ['db']) // db is typed
  .addSingleton(route('class'), RouteClass)
  .addTransient(route('transient'), (): Route => ({ path: '/t' }))
  .addInstance(route('value'), { path: '/v' });
expectTypeOf(checked.get('fromDb:route')).toEqualTypeOf<{ path: string }>();
expectTypeOf(checked.get('class:route')).toEqualTypeOf<RouteClass>();
// @ts-expect-error: not a Route
new DIContainer().addSingleton(route('bad'), () => ({ nope: 1 }));
// @ts-expect-error: a class that isn't a Route
new DIContainer().addSingleton(route('bad'), NotARoute);
// @ts-expect-error: a value that isn't a Route
new DIContainer().addInstance(route('bad'), { nope: 1 });
// @ts-expect-error: in a DIContainer, a promise of a Route isn't a Route (collect() would get the promise)
new DIContainer().addSingleton(route('bad'), async (): Promise<Route> => ({
  path: '/',
}));
// an AsyncDIContainer resolves it: a promise of the type is fine
new AsyncDIContainer().addSingleton(
  route('async'),
  async (): Promise<Route> => ({ path: '/' }),
);
// @ts-expect-error: in modules too
const badModule = (c: ServiceRegistry) => c.addSingleton(route('bad'), () => 1);
void badModule;
const untyped = createTag('cmd');
expectTypeOf(untyped).toEqualTypeOf<Tag<unknown, 'cmd'>>();
// an untyped tag accepts anything
new DIContainer().addSingleton(untyped('any'), () => 1);

const app = new DIContainer()
  .addSingleton(route('orders'), (): Route => ({ path: '/orders' }))
  .namespace('Billing', (c) =>
    c.addSingleton(route('billing'), (): Route => ({ path: '/billing' })),
  )
  .addSingleton(
    'router',
    (routes) => {
      expectTypeOf(routes).toEqualTypeOf<Route[]>();
      return routes;
    },
    [collect(route)],
  )
  .addSingleton(
    'hooks',
    (hooks) => {
      expectTypeOf(hooks).toEqualTypeOf<LifecycleHook[]>();
      return hooks.length;
    },
    [collect(lifecycle.start)],
  );
expectTypeOf(app.get('router')).toEqualTypeOf<Route[]>();

const asyncApp = new AsyncDIContainer().addSingleton(
  'router',
  (routes) => {
    expectTypeOf(routes).toEqualTypeOf<Route[]>();
    return routes;
  },
  [collect(route)],
);
void asyncApp;

class Bus {
  emit() {}
}
class Consumer {
  constructor(readonly bus: Bus) {}
  start() {}
  async stop() {}
}
const addPayments = (c: ServiceRegistry<{ bus: Bus }>) =>
  c.extend(
    startable('consumer', Consumer, ['bus'], {
      start: (consumer) => {
        expectTypeOf(consumer).toEqualTypeOf<Consumer>();
        consumer.start();
      },
      stop: (consumer, signal) => {
        void signal;
        return consumer.stop();
      },
    }),
  );
const withPayments = new DIContainer()
  .addSingleton('bus', Bus)
  .namespace('Payments', addPayments)
  .seal();
expectTypeOf(withPayments.get('Payments.consumer')).toEqualTypeOf<Consumer>();
void startLifecycle(withPayments);
// @ts-expect-error: no bus
new DIContainer().extend(startable('consumer', Consumer, ['bus'], {}));
const stringBus = new DIContainer().addInstance('bus', 'x');
const needsBus = startable('consumer', Consumer, ['bus'], {});
// @ts-expect-error: bus is a string
stringBus.extend(needsBus);
const inInit = new DIContainer().addSingleton('bus', Bus).extend(
  startable('consumer', Consumer, ['bus'], {
    stage: lifecycle.init,
    start: (c) => c.start(),
  }),
);
expectTypeOf(inInit.get('consumer:init')).toEqualTypeOf<LifecycleHook>();
const fn = new DIContainer().addInstance('port', 1).extend(
  startable('server', (port: number) => ({ port, listen() {} }), ['port'], {
    start: (s) => s.listen(),
  }),
);
expectTypeOf(fn.get('server').port).toEqualTypeOf<number>();

// ---- startable() in an AsyncDIContainer: the service is the resolved type
const asyncPayments = new AsyncDIContainer()
  .addSingleton('bus', async () => new Bus())
  .extend(
    startable('consumer', Consumer, ['bus'], {
      start: (consumer, signal) => {
        expectTypeOf(consumer).toEqualTypeOf<Consumer>();
        expectTypeOf(signal).toEqualTypeOf<AbortSignal>();
      },
    }),
  );
expectTypeOf(asyncPayments.get('consumer')).toEqualTypeOf<Promise<Consumer>>();
const needsBusAsync = startable('consumer', Consumer, ['bus'], {});
// @ts-expect-error: no bus
new AsyncDIContainer().extend(needsBusAsync);

// ---- startSignal(): a hook's dependency on the start signal
new DIContainer().addSingleton(
  lifecycle.init('config'),
  (signal) => {
    expectTypeOf(signal).toEqualTypeOf<AbortSignal>();
  },
  [startSignal],
);

// ---- registering under a generic key (a helper module) is not affected by tag checks
const addCounter =
  <const K extends string>(key: K) =>
  (c: ServiceRegistry<{ start: number }>) =>
    c.addSingleton(key, (start) => start + 1, ['start']);
const counters = new DIContainer()
  .addInstance('start', 0)
  .extend(addCounter('visits'));
expectTypeOf(counters.get('visits')).toEqualTypeOf<number>();

// ---- a key built by a tag looks up its service, like its plain key
const lookups = new DIContainer()
  .addSingleton(route('home'), (): Route => ({ path: '/' }))
  .addSingleton('viaDependency', (home) => home.path, [route('home')])
  .addSingleton('viaOptional', (home) => home?.path, [optional(route('home'))])
  .addSingleton(route('home'), (home) => ({ path: `${home.path}!` }), {
    dependencies: [route('home')], // decorating a contribution
    replace: true,
  })
  .addAlias(route('start'), route('home'))
  .addSingleton(lifecycle.init('warmup'), () => {});
expectTypeOf(lookups.get(route('home'))).toEqualTypeOf<{ path: string }>();
expectTypeOf(lookups.get('home:route')).toEqualTypeOf<{ path: string }>();
expectTypeOf(lookups.get('viaDependency')).toEqualTypeOf<string>();
expectTypeOf(lookups.get('viaOptional')).toEqualTypeOf<string | undefined>();
expectTypeOf(lookups.get(route('start'))).toEqualTypeOf<{ path: string }>();
expectTypeOf(lookups.createResolver(route('home'))).toEqualTypeOf<
  () => { path: string }
>();
expectTypeOf(lookups.get(lifecycle.init('warmup'))).toEqualTypeOf<void>();
expectTypeOf(
  new AsyncDIContainer()
    .addSingleton(route('home'), async (): Promise<Route> => ({ path: '/' }))
    .get(route('home')),
).toEqualTypeOf<Promise<Route>>();
// @ts-expect-error: not registered
lookups.get(route('missing'));
// @ts-expect-error: an alias under a tag must point to a service of the tag's type
new DIContainer().addInstance('db', { q: 1 }).addAlias(route('bad'), 'db');
