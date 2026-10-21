---
title: Express
description: Use injecute with Express — typed services in handlers without app.locals, routers contributed by feature modules, request context, graceful shutdown, and tests with supertest.
---

# Express

Express has no place for services. Apps import module-level singletons, which tests can only replace
with module mocks, or hang them on `app.locals` and `res.locals`, which are untyped. With injecute:

- **Typed services in handlers.** A router's factory receives the services it needs, and its handlers
  close over them: no `app.locals` casts, no container on `req`.
- **Wiring in one place.** The composition root lists every service and what it depends on. A missing
  service is a compile error, not a `TypeError` on the first request that needs it.
- **Modules bring their own routers.** Feature modules contribute routers to an extension point; the
  HTTP module doesn't import them.
- **Shutdown in the right order.** The server stops accepting requests and finishes the open ones before
  the database pool closes. Express has no shutdown of its own.
- **Tests without module mocks.** An isolated fork replaces the database for the whole graph, and
  supertest calls the same Express app.
- **Services without Express.** `OrderService` doesn't import Express, so a queue worker or a CLI uses
  it as it is.

## The HTTP module

The HTTP module owns the Express app and the server. It declares an
[extension point](../guide/tags.md) for routers, and starts the server in a
[lifecycle hook](../guide/startup-shutdown.md):

```ts
// http.ts
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import express, { type Router } from 'express';
import { collect, createTag, lifecycle, type ServiceRegistry } from 'injecute';
import { storage } from './context.ts';

/** A router a module mounts under a path. */
export interface Route {
  readonly path: string;
  readonly router: Router;
}
/** The extension point: every module's routers. */
export const route = createTag('route').of<Route>();

export const addHttp = (c: ServiceRegistry<{ port: number }>) =>
  c
    .addSingleton(
      'http',
      (routes) => {
        const http = express();
        http.use(express.json());
        // after the body parsers: the handlers run in this context
        http.use((req, _res, next) =>
          storage.run(
            {
              traceId: req.get('x-request-id') ?? randomUUID(),
              tenantId: req.get('x-tenant-id'),
            },
            next,
          ),
        );
        for (const { path, router } of routes) http.use(path, router);
        return http;
      },
      [collect(route)],
    )
    .addSingleton(
      lifecycle.start('server'),
      async (http, port) => {
        const server = http.listen(port);
        await once(server, 'listening'); // rejects when the port is taken
        // undo: stop accepting connections and wait for open requests
        return () =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          );
      },
      ['http', 'port'],
    );
```

- `collect(route)` receives the routers of every module, also from namespaces, in registration order.
- Each request runs in `storage.run()`, so services read the trace id and tenant through the
  [context accessor](../guide/request-context.md), without the request being passed to them.
- The server is a hook, so `running.stop()` closes it before `dispose()` releases the connections. To
  force open connections closed after a timeout, see
  [Timeouts and cancellation](../guide/startup-shutdown.md#timeouts-and-cancellation).

## A feature module

A module registers its services and contributes a router. The handlers close over `orders`:

```ts
// orders.ts
import { Router } from 'express';
import type { ServiceRegistry } from 'injecute';
import { route, type Route } from './http.ts';

export const addOrders = (c: ServiceRegistry<{ db: Database }>) =>
  c.addSingleton('orders', OrderService, ['db']).addSingleton(
    route('orders'),
    (orders): Route => {
      const router = Router();
      router.get('/', async (_req, res) => {
        res.json(await orders.list());
      });
      router.post('/', async (req, res) => {
        res.status(201).json(await orders.place(req.body.item));
      });
      return { path: '/orders', router };
    },
    ['orders'],
  );
```

The router is created once, with the app. Express 5 passes a rejected promise from an async handler to
your error middleware; an `InjecuteError` there has a stable [`code`](../errors/index.md).

## The composition root

The host keeps the request context in `AsyncLocalStorage`. `RequestContext` and `ContextAccessor` are
the application's types, as in [Request context](../guide/request-context.md#the-application-declares-what-it-needs):

```ts
// context.ts
import { AsyncLocalStorage } from 'node:async_hooks';

export const storage = new AsyncLocalStorage<RequestContext>();
export const context: ContextAccessor<RequestContext> = {
  current: () => storage.getStore(),
};
```

```ts
// app.ts
import { DIContainer } from 'injecute';
import { context } from './context.ts';
import { addHttp } from './http.ts';
import { addOrders } from './orders.ts';

export const createApp = () =>
  new DIContainer()
    .addInstance('config', loadConfig())
    .addInstance('context', context)
    .addSingleton('port', (config) => config.port, ['config'])
    .addSingleton('db', (config) => new Database(config.databaseUrl), {
      dependencies: ['config'],
      dispose: (db) => db.close(),
    })
    .extend(addHttp)
    .namespace('Orders', addOrders)
    .seal();
```

```ts
// main.ts
import { startLifecycle } from 'injecute';
import { createApp } from './app.ts';

const running = await startLifecycle(createApp());
process.once('SIGTERM', () =>
  running.stop().catch((error) => console.error(error)),
);
```

`running.stop()` closes the server, waits for open requests, then closes the database. For a complete
entry point with a grace period and a second signal, see
[Graceful shutdown in Node.js](../guide/startup-shutdown.md#graceful-shutdown-in-node-js).

## Tests

Build the app, replace the database in an isolated fork, and send requests to its Express app with
[supertest](https://github.com/ladjs/supertest):

```ts
// orders.test.ts
import request from 'supertest';
import { expect, it } from 'vitest';
import { createApp } from './app.ts';

it('places an order', async () => {
  await using test = createApp()
    .fork({ isolated: true })
    .addInstance('db', new FakeDatabase(), { replace: true });

  const response = await request(test.get('http'))
    .post('/orders')
    .send({ item: 'book' });

  expect(response.status).toBe(201);
});
```

The test doesn't start the lifecycle: supertest calls the Express app without the server hook. The
fork's `OrderService` and router are built with the fake database, `createApp()`'s are untouched, and
`await using` disposes what the test created. See [Testing](../guide/testing.md).
