---
title: Fastify
description: Use injecute with Fastify — Fastify plugins for HTTP, the container for services, typed without declaration merging, route plugins contributed by modules, request context, graceful shutdown, and tests with inject().
---

# Fastify

Fastify has plugins and decorators: `fastify.decorate('db', db)` makes the database reachable from
handlers. To type it, you add `declare module 'fastify'` with `db` on every Fastify instance, whether
the plugin that decorates it was registered or not. With injecute:

- **Typed from the registrations.** No declaration merging: a service's type comes from its factory,
  and a module that needs a missing service is a compile error.
- **Plugins for HTTP, the container for services.** Keep Fastify plugins for what is about HTTP (auth
  hooks, CORS, rate limits, schemas). Repositories, clients and domain services live in the container,
  so a queue worker, a script or a test uses them without starting Fastify.
- **Modules bring their own routes.** Each feature module contributes a route plugin with its prefix;
  the HTTP module doesn't import the features.
- **Shutdown in the right order.** `server.close()` runs first, waits for open requests and runs your
  `onClose` hooks; then the database pool closes.
- **Tests with `inject()`.** An isolated fork replaces the database for the whole graph, and
  `server.inject()` sends requests without a port.

## The HTTP module

The HTTP module declares an [extension point](../guide/tags.md) for route plugins, and starts the server
in a [lifecycle hook](../guide/startup-shutdown.md):

```ts
// http.ts
import Fastify, { type FastifyPluginAsync } from 'fastify';
import { collect, createTag, lifecycle, type ServiceRegistry } from 'injecute';
import { storage } from './context.ts';

/** A Fastify plugin a module registers under a prefix. */
export interface Routes {
  readonly prefix: string;
  readonly plugin: FastifyPluginAsync;
}
/** The extension point: every module's routes. */
export const routes = createTag('routes').of<Routes>();

export const addHttp = (c: ServiceRegistry<{ port: number }>) =>
  c
    // a factory, not the instance: a Fastify instance is thenable
    .addSingleton(
      'createServer',
      (contributions) => () => {
        const server = Fastify({ logger: true });
        // preValidation runs after the body is parsed: the handlers run in this context
        server.addHook('preValidation', (request, _reply, done) => {
          storage.run(
            {
              traceId: request.id,
              tenantId: request.headers['x-tenant-id'] as string | undefined,
            },
            done,
          );
        });
        for (const { prefix, plugin } of contributions)
          server.register(plugin, { prefix });
        return server;
      },
      [collect(routes)],
    )
    .addSingleton(
      lifecycle.start('server'),
      async (createServer, port) => {
        const server = createServer();
        await server.listen({ port, host: '0.0.0.0' });
        return () => server.close(); // stops accepting requests, waits for open ones, runs onClose hooks
      },
      ['createServer', 'port'],
    );
```

::: warning Register a factory, not the Fastify instance
A Fastify instance is thenable: `await server` waits for `ready()`. A factory that returns it is treated
like an [async factory](../guide/async.md), so `get()` would return a promise instead of the server.
Register a function that creates the server, as above; tests call it too.
:::

The server is a hook, so `running.stop()` closes it before `dispose()` releases the connections.

## A feature module

A module registers its services and contributes a route plugin. The handlers close over `orders`:

```ts
// orders.ts
import type { ServiceRegistry } from 'injecute';
import { routes, type Routes } from './http.ts';

export const addOrders = (c: ServiceRegistry<{ db: Database }>) =>
  c.addSingleton('orders', OrderService, ['db']).addSingleton(
    routes('orders'),
    (orders): Routes => ({
      prefix: '/orders',
      plugin: async (server) => {
        server.get('/', () => orders.list());
        server.post<{ Body: { item: string } }>(
          '/',
          {
            schema: {
              body: {
                type: 'object',
                required: ['item'],
                properties: { item: { type: 'string' } },
              },
            },
          },
          async (request, reply) =>
            reply.code(201).send(await orders.place(request.body.item)),
        );
      },
    }),
    ['orders'],
  );
```

Each route plugin is encapsulated by Fastify as usual: hooks and decorators it adds stay in its prefix.

## The composition root

```ts
// app.ts
import { DIContainer } from 'injecute';
import { storage } from './context.ts'; // export const storage = new AsyncLocalStorage<RequestContext>()
import { addHttp } from './http.ts';
import { addOrders } from './orders.ts';

export const createApp = () =>
  new DIContainer()
    .addInstance('config', loadConfig())
    .addInstance('context', { current: () => storage.getStore() })
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

For a complete entry point with a grace period and a second signal, see
[Graceful shutdown in Node.js](../guide/startup-shutdown.md#graceful-shutdown-in-node-js). Don't call
`dispose()` in an `onClose` hook: the lifecycle closes the server first and disposes after it.

## Request context

The HTTP module starts the [request context](../guide/request-context.md) in a `preValidation` hook.

::: warning Start the context after the body is parsed
For requests with a body, Fastify runs the hooks after parsing from the request stream's `end` event, in
a different async context, so a context started in `onRequest` can be lost by the handler. Start it in
`preValidation`, or use [`@fastify/request-context`](https://github.com/fastify/fastify-request-context),
which re-enters its context there, and read it in the accessor:
`{ current: () => requestContext.get('context') }`.
:::

Fastify's `request.log` carries the request id, but only where you pass the request. A logger in the
container that reads the context works in every service; see
[Logging](../guide/request-context.md#logging). To use one pino instance for both, register it in the
container and give it to Fastify: `Fastify({ loggerInstance: logger })`.

## Tests

Build the app, replace the database in an isolated fork, create a server from the fork and send it
requests with `inject()`:

```ts
// orders.test.ts
import { expect, it } from 'vitest';
import { createApp } from './app.ts';

it('places an order', async () => {
  await using test = createApp()
    .fork({ isolated: true })
    .addInstance('db', new FakeDatabase(), { replace: true });

  const server = test.get('createServer')();
  const response = await server.inject({
    method: 'POST',
    url: '/orders',
    payload: { item: 'book' },
  });

  expect(response.statusCode).toBe(201);
  await server.close();
});
```

The test doesn't start the lifecycle, so nothing listens. The fork's route plugins are built with the fake
database, `createApp()`'s are untouched, and `await using` disposes what the test created. See
[Testing](../guide/testing.md).

## Plugins or services?

| Put it in             | When                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------ |
| A Fastify plugin      | It is about HTTP: authentication hooks, CORS, rate limits, content parsers, shared schemas |
| The container         | The app uses it: repositories, clients, domain services, the logger, configuration         |
| A route plugin by tag | A feature module's routes, built with the module's services                                |
