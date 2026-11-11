// An app whose modules plug into each other: Orders contributes a route to the HTTP module's router and
// subscribes to the platform's event bus at startup; Payments starts a queue consumer. The composition
// root starts everything with startLifecycle() and stops it in reverse. The Console tab shows the order.
import {
  collect,
  createLifecycle,
  createTag,
  DIContainer,
  lifecycle,
  startable,
  startLifecycle,
  type ServiceRegistry,
} from 'injecute';

export const log: string[] = [];

// #region platform
class EventBus {
  private readonly handlers = new Map<string, ((event: unknown) => void)[]>();

  /** Subscribes; returns the function that unsubscribes. */
  on(type: string, handler: (event: unknown) => void): () => void {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]);
    return () =>
      this.handlers.set(
        type,
        (this.handlers.get(type) ?? []).filter((h) => h !== handler),
      );
  }

  emit(type: string, event: unknown): void {
    for (const handler of this.handlers.get(type) ?? []) handler(event);
  }
}

interface Route {
  readonly path: string;
  handle(): string;
}

/** The router's extension point: modules register routes under it (see Extension points with tags). */
export const route = createTag('route').of<Route>();

class Router {
  readonly routes: Map<string, () => string>;
  constructor(routes: Route[]) {
    this.routes = new Map(routes.map((r) => [r.path, r.handle]));
  }
}

class HttpServer {
  constructor(private readonly router: Router) {}
  listen(port: number): void {
    log.push(
      `listening on ${port}: ${[...this.router.routes.keys()].join(', ')}`,
    );
  }
  async close(): Promise<void> {
    log.push('server closed');
  }
}

class Readiness {
  ready = false;
}

// The platform owns the bus and the router; it starts the server when the app starts.
const addPlatform = (c: ServiceRegistry<{ port: number }>) =>
  c
    .addSingleton('bus', EventBus)
    .addSingleton('router', Router, [collect(route)]) // every module's routes
    .addSingleton('server', HttpServer, ['router'])
    .addSingleton('readiness', Readiness)
    .addSingleton(
      lifecycle.start('server'), // the key 'server:start'
      (server, port) => {
        server.listen(port);
        return () => server.close(); // undo: runs when the app stops
      },
      ['server', 'port'],
    )
    .addSingleton(
      lifecycle.ready('readiness'),
      (readiness) => {
        readiness.ready = true;
        return () => {
          readiness.ready = false; // the first thing to undo: stop getting traffic
        };
      },
      ['readiness'],
    );
// #endregion platform

// #region contribute
class OrderService {
  readonly paid: string[] = [];
  list(): string {
    return `orders: ${this.paid.join(', ')}`;
  }
}

// Orders doesn't change the platform. It contributes a route under the router's tag, and subscribes to
// the bus (a registry that changes at runtime) in an `init` hook that returns the unsubscribe.
const addOrders = (c: ServiceRegistry<{ bus: EventBus }>) =>
  c
    .addSingleton('service', OrderService)
    .addSingleton(
      route('list'),
      (service): Route => ({ path: '/orders', handle: () => service.list() }),
      ['service'],
    )
    .addSingleton(
      lifecycle.init('subscriptions'),
      (bus, service) =>
        bus.on('payment.succeeded', (orderId) =>
          service.paid.push(String(orderId)),
        ), // returns the unsubscribe function: the undo
      ['bus', 'service'],
    );

class PaymentConsumer {
  constructor(private readonly bus: EventBus) {}
  start(): void {
    log.push('consumer started');
    this.bus.emit('payment.succeeded', 'order-1');
  }
  async stop(): Promise<void> {
    log.push('consumer stopped');
  }
}

// A service that only starts and stops: startable() registers it and its `start` hook.
const addPayments = (c: ServiceRegistry<{ bus: EventBus }>) =>
  c.extend(
    startable('consumer', PaymentConsumer, ['bus'], {
      start: (consumer) => consumer.start(),
      stop: (consumer) => consumer.stop(),
    }),
  );
// #endregion contribute

// #region start-stop
export const createApp = () =>
  new DIContainer()
    .addInstance('port', 8080)
    .extend(addPlatform)
    .namespace('Orders', addOrders)
    .namespace('Payments', addPayments)
    .seal();

export async function main(): Promise<void> {
  const app = createApp();
  // init → start → ready; in Node.js: process.once('SIGTERM', () => running.stop().catch(console.error))
  const running = await startLifecycle(app);
  log.push(`started: ${running.hooks.join(', ')}`);
  log.push(app.get('router').routes.get('/orders')!());

  await running.stop(); // undo ready → start → init, then app.dispose()
}
// #endregion start-stop

// #region testing
// In tests: run only `init` on an isolated fork, with replacements; nothing listens.
export async function wiringInTests(): Promise<string> {
  const test = createApp()
    .fork({ isolated: true })
    .addInstance('port', 0, { replace: true });
  await using running = await startLifecycle(test, {
    lifecycle: createLifecycle(['init']),
  });
  return `${running.hooks.join(', ')} → ${[...test.get('router').routes.keys()].join(', ')}`;
}
// #endregion testing

// #region failure
export async function failingStart(): Promise<string> {
  const broken = new DIContainer()
    .addSingleton(lifecycle.init('cache'), () => {
      log.push('cache warmed');
      return () => log.push('cache cleared');
    })
    .addSingleton(lifecycle.start('server'), () => {
      throw new Error('port 8080 is in use');
    });
  try {
    await startLifecycle(broken);
    return 'started';
  } catch (error) {
    // what ran is undone, the container is disposed, the error names the hook
    return error instanceof Error
      ? error.message.split('\n')[0]!
      : String(error);
  }
}
// #endregion failure

// #region custom-stages
// An app with its own stages gives its modules this object instead of `lifecycle`.
export const stages = createLifecycle(['migrate', 'init', 'start']);

export async function migrateThenStart(): Promise<string[]> {
  const steps: string[] = [];
  const cli = new DIContainer()
    .addSingleton(stages.start('jobs'), () => {
      steps.push('jobs');
    })
    .addSingleton(stages.migrate('schema'), () => {
      steps.push('schema');
    });
  const running = await startLifecycle(cli, { lifecycle: stages });
  await running.stop();
  return steps;
}
// #endregion custom-stages

await main();
for (const line of log) console.log(line);

// The playground draws this container's graph (it doesn't run the hooks): hooks are services too.
export default createApp();
