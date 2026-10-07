// Type-level tests for tags, collect() and startable(). Checked by `npm run typecheck` (tsc), not executed.
import { expectTypeOf } from 'vitest';
import {
  collect,
  createTag,
  DIContainer,
  AsyncDIContainer,
  lifecycle,
  startable,
  startLifecycle,
  type ServiceRegistry,
  type LifecycleHook,
  type Tag,
} from '../../src/index.ts';

interface Route {
  path: string;
}
const route = createTag('route').of<Route>();
expectTypeOf(route).toEqualTypeOf<Tag<Route, 'route'>>();
expectTypeOf(route('orders')).toEqualTypeOf<'orders:route'>();
const untyped = createTag('cmd');
expectTypeOf(untyped).toEqualTypeOf<Tag<unknown, 'cmd'>>();

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
