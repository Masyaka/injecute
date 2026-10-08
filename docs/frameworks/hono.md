---
title: Hono
description: Use injecute with Hono on Node.js, Bun, Deno and Cloudflare Workers — services built once and typed from the registrations, routes contributed by modules, request context, graceful shutdown, and tests with app.request().
---

# Hono

Hono runs on every JavaScript runtime, and so does injecute: no runtime dependencies, no decorators, no
`reflect-metadata`, no build step. The same modules run on Node.js, Bun, Deno and Cloudflare Workers.

Hono's context variables (`c.set()`, `c.var`) carry the values of one request, typed by hand in the app's
`Env`. They are a poor place for services: a middleware sets them again on every request, and only
handlers can read them. With injecute:

- **Services built once, typed from the registrations.** Handlers close over the services they need; a
  missing service is a compile error.
- **Request data reaches every layer.** A middleware starts the request context, and services deep in
  the graph read it through an accessor. Keep `c.var` for what only handlers use.
- **Modules bring their own routes.** Each feature module contributes a Hono sub-app; the HTTP module
  doesn't import the features.
- **Shutdown in the right order** on Node.js, Bun and Deno: the server finishes open requests before
  the connections close.
- **Tests with `app.request()`**, without a server.

## The HTTP module

The HTTP module declares an [extension point](../guide/tags.md) for routes, and starts the
[request context](../guide/request-context.md) for each request:

```ts
// http.ts
import { Hono } from 'hono';
import { collect, createTag, type ServiceRegistry } from 'injecute';
import { storage } from './context.ts'; // export const storage = new AsyncLocalStorage<RequestContext>()

/** A Hono app a module mounts under a path. */
export interface Route {
  readonly path: string;
  readonly app: Hono;
}
/** The extension point: every module's routes. */
export const route = createTag('route').of<Route>();

export const addHttp = (c: ServiceRegistry) =>
  c.addSingleton(
    'http',
    (routes) => {
      const http = new Hono();
      http.use((c, next) =>
        storage.run(
          {
            traceId: c.req.header('x-request-id') ?? crypto.randomUUID(),
            tenantId: c.req.header('x-tenant-id'),
          },
          next,
        ),
      );
      for (const { path, app } of routes) http.route(path, app);
      return http;
    },
    [collect(route)],
  );
```

Hono's [context storage](https://hono.dev/docs/middleware/builtin/context-storage) middleware works
too: add `contextStorage()` and read the accessor from it,
`{ current: () => tryGetContext<Env>()?.var.requestContext }`.

## A feature module

A module registers its services and contributes a sub-app. The handlers close over `orders`:

```ts
// orders.ts
import { Hono } from 'hono';
import type { ServiceRegistry } from 'injecute';
import { route, type Route } from './http.ts';

export const addOrders = (c: ServiceRegistry<{ db: Database }>) =>
  c.addSingleton('orders', OrderService, ['db']).addSingleton(
    route('orders'),
    (orders): Route => ({
      path: '/orders',
      app: new Hono()
        .get('/', async (c) => c.json(await orders.list()))
        .post('/', async (c) => {
          const { item } = await c.req.json<{ item: string }>();
          return c.json(await orders.place(item), 201);
        }),
    }),
    ['orders'],
  );
```

## The application, on every runtime

The application is a module. It needs a database and a context accessor, and each runtime's entry point
provides them:

```ts
// app.ts
import type { ServiceRegistry } from 'injecute';
import { addHttp } from './http.ts';
import { addOrders } from './orders.ts';

export const addApp = (
  c: ServiceRegistry<{
    db: Database;
    context: ContextAccessor<RequestContext>;
  }>,
) => c.extend(addHttp).namespace('Orders', addOrders);
```

## Node.js, Bun and Deno

The entry point registers the database and the context, the application, and the server as a
[lifecycle hook](../guide/startup-shutdown.md):

::: code-group

```ts [Node.js]
// server.ts
import { once } from 'node:events';
import { serve } from '@hono/node-server';
import { DIContainer, lifecycle, startLifecycle } from 'injecute';
import { addApp } from './app.ts';
import { storage } from './context.ts';

const app = new DIContainer()
  .addInstance('config', loadConfig())
  .addInstance('context', { current: () => storage.getStore() })
  .addSingleton('db', (config) => new Database(config.databaseUrl), {
    dependencies: ['config'],
    dispose: (db) => db.close(),
  })
  .extend(addApp)
  .addSingleton(
    lifecycle.start('server'),
    async (http, config) => {
      const server = serve({ fetch: http.fetch, port: config.port });
      await once(server, 'listening'); // rejects when the port is taken
      return () =>
        new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
    },
    ['http', 'config'],
  )
  .seal();

const running = await startLifecycle(app);
process.once('SIGTERM', () =>
  running.stop().catch((error) => console.error(error)),
);
```

```ts [Bun]
// the hook in server.ts
.addSingleton(
  lifecycle.start('server'),
  (http, config) => {
    const server = Bun.serve({ fetch: http.fetch, port: config.port });
    return () => server.stop(); // waits for open requests
  },
  ['http', 'config'],
)
```

```ts [Deno]
// the hook in server.ts
.addSingleton(
  lifecycle.start('server'),
  (http, config) => {
    const server = Deno.serve({ port: config.port }, http.fetch);
    return () => server.shutdown(); // waits for open requests
  },
  ['http', 'config'],
)
```

:::

`running.stop()` stops the server, then `dispose()` closes the database. See
[Graceful shutdown in Node.js](../guide/startup-shutdown.md#graceful-shutdown-in-node-js) for a grace
period and a second signal.

## Cloudflare Workers

A Worker has no server to start: it exports `fetch`. Build the root once per isolate, with the bindings
from `cloudflare:workers`:

```ts
// worker.ts
import { AsyncLocalStorage } from 'node:async_hooks';
import { env } from 'cloudflare:workers';
import { DIContainer } from 'injecute';
import { addApp } from './app.ts';

const storage = new AsyncLocalStorage<RequestContext>();

const app = new DIContainer()
  .addInstance('context', { current: () => storage.getStore() })
  .addInstance('db', createDatabase(env.DB)) // a D1 binding: safe to share between requests
  .extend(addApp)
  .seal();

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) =>
    app.get('http').fetch(request, env, ctx),
};
```

- **A connection belongs to one request.** Workers don't let a request use a socket or a stream that
  another request opened ("Cannot perform I/O on behalf of a different request"). Bindings (KV, D1, R2,
  queues) are safe in singletons; a database client that holds a connection is not. Register a factory
  and connect per request with `await using` ([a unit of work](../guide/request-state.md#a-factory-and-using-a-unit-of-work)),
  or keep [one instance per request](../guide/request-state.md#one-instance-per-request).
- **No shutdown.** An isolate is evicted without notice, so there is no lifecycle to stop and the
  container is never disposed. Hand work that outlives the response to `ctx.waitUntil()`.
- **`AsyncLocalStorage` needs the `nodejs_compat` compatibility flag.**

## Tests

Build the application on a test root with a fake database, and send requests with `app.request()`:

```ts
// orders.test.ts
import { DIContainer } from 'injecute';
import { expect, it } from 'vitest';
import { addApp } from './app.ts';

it('places an order', async () => {
  await using test = new DIContainer()
    .addInstance('db', new FakeDatabase())
    .addInstance('context', { current: () => undefined })
    .extend(addApp);

  const response = await test.get('http').request('/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ item: 'book' }),
  });

  expect(response.status).toBe(201);
});
```

No server runs, and the test doesn't touch the runtime: the same test covers the Node.js, Bun, Deno and
Workers builds. To replace a service of an entry point's root instead, use an isolated fork; see
[Testing](../guide/testing.md).
