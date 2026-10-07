---
title: Structuring an app
description: Keep the web framework out of the application core, and keep the container wiring in files of its own. What each gives you, what it costs, and when to do otherwise.
---

# Structuring an app

Two recommendations for an app that grows beyond one file. Both are defaults, not rules: each section
says when to do otherwise.

## Keep the web framework out of the core

Build the container around the **application core**: configuration, connections, repositories, domain
services. Keep the **web bindings** (routes, middleware, the server) in a layer of their own that
receives the core and resolves what it needs from it:

```ts
// core/container.ts: no web framework imports
export const createCore = () =>
  new DIContainer()
    .addInstance('config', loadConfig())
    .extend(addDatabase)
    .namespace('Orders', addOrders)
    .seal();

export type Core = ReturnType<typeof createCore>;
```

```ts
// web/orders.ts: the web layer gets services through a provider
export const ordersRouter = (
  core: ServiceProvider<{ 'Orders.orders': OrderService }>,
) => {
  const orders = core.get('Orders.orders');
  const router = Router();
  router.get('/', async (_req, res) => {
    res.json(await orders.list());
  });
  return router;
};

// web/server.ts
export const createHttpApp = (core: Core) => {
  const http = express();
  http.use(express.json());
  http.use('/orders', ordersRouter(core));
  return http;
};
```

The entry point connects them, and stops the server before the core releases its connections:

```ts
// main.ts
const core = createCore();
const running = await startLifecycle(core);
const server = createHttpApp(core).listen(core.get('config').port);

process.once('SIGTERM', () =>
  server.close(() => running.stop().catch((error) => console.error(error))),
);
```

The dependency points one way: the web layer imports the core, and the core never imports the web layer.

### What you get

- **One core for every entry point.** The HTTP server, a queue worker, a cron job and a CLI build the same
  core and add their own bindings. None of them carries another's framework.
- **The framework is replaceable.** Upgrading Express or moving to Fastify or Hono changes the web
  layer only. The core, and its tests, don't change.
- **Tests at the right level.** Core tests use an isolated fork and send no HTTP requests. Web tests build
  the web layer on a core fork with fakes.
- **The framework works its own way.** Plugin encapsulation, route-level typing (Hono's RPC client,
  Fastify's type providers) and the framework's test helpers are used as their docs describe, without
  passing through the container.
- **A readable container.** The services graph shows the domain, not routers and middleware. The
  container type stays smaller, so it is faster to typecheck.

### What it costs

- **A seam to maintain.** The web layer resolves services at its edge, through a `ServiceProvider`
  typed with what it needs. That is service location, kept to one layer: below it, everything is
  injected.
- **Routes are listed by hand.** A feature module can't contribute its routes on its own: the web layer
  mounts each feature's router. That list is explicit, but it is one more place to touch when you add a
  feature.
- **You order the shutdown.** The server isn't a lifecycle hook, so the entry point stops it before
  `running.stop()`.

### When to put the framework in the container

It works: the [framework pages](../frameworks/index.md) show it. Prefer it when:

- features are plugins that bring their own routes, and adding one must not touch the web layer (an
  [extension point](./tags.md) for routes);
- the server is one of several things the lifecycle starts and stops in order (consumers, schedulers),
  and you want it as a hook like the others;
- the app is small, and one container is simpler than two layers.

## Keep the wiring in files of its own

Put each module's registrations in a file that only wires, and the composition root in one more:

```text
src/
  orders/
    orders-service.ts     plain classes: no injecute imports
    orders-repository.ts
    orders.container.ts   addOrders: registrations only
  billing/
    billing.container.ts
  container.ts            the composition root: createApp()
  main.ts                 the entry point: start, signals
```

```ts
// orders/orders.container.ts
import type { ServiceRegistry } from 'injecute';
import { OrdersRepository } from './orders-repository.ts';
import { OrdersService } from './orders-service.ts';

export const addOrders = (c: ServiceRegistry<{ db: Database }>) =>
  c
    .addSingleton('repo', OrdersRepository, ['db'])
    .addSingleton('orders', OrdersService, ['repo']);
```

```ts
// container.ts
export const createApp = () =>
  new DIContainer()
    .addInstance('config', loadConfig())
    .extend(addDatabase)
    .namespace('Orders', addOrders)
    .namespace('Billing', addBilling)
    .seal();
```

What belongs in a wiring file: imports of classes and factories, registrations, and small adapters
(`(config) => config.port`). What doesn't: business logic, classes, side effects on import, and built
containers. Export a module function or `createApp()`, never a container created at the top of the file.

### What you get

- **Plain classes.** Services don't import injecute or the container. They are tested with `new`, reused
  without the container, and unchanged if you replace it.
- **The wiring in one place.** A module's dependencies are readable in one file, and a change to them
  is a change to that file in review.
- **No import cycles.** Wiring files import services; services never import wiring.
- **Safe to import.** A wiring file has no side effects, so tests, scripts and tools
  (`buildServicesGraph()`) load it freely, and each `createApp()` call is a new container. A test never
  shares the app's instances by accident.
- **Easy to adopt and to remove.** Introducing injecute adds wiring files; removing it deletes them.

### What it costs

- **More files.** A small feature has a service file and a wiring file of a few lines.
- **The dependency list is away from the constructor.** You read two files to see a class's
  dependencies. The compiler checks that the list matches the constructor, so a mismatch is a compile
  error, not a bug.
- **A naming convention to agree on**, such as `*.container.ts` or `module.ts` per feature.

### When one file is enough

A script or a small service with a handful of registrations: keep them in one `container.ts`. Split
when a feature's wiring grows, or when two features change it in the same week.
