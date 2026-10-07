---
title: Request context
description: Give every service the trace id, tenant and user of the current request with a context accessor backed by AsyncLocalStorage.
---

# Request context

Services often need to know about the current request: a logger adds the trace id, a repository
filters by tenant, an audit log records the user. The recommended way is a **context accessor**:

1. The application declares the context it needs and depends on an accessor for it.
2. The host (an HTTP server, a queue worker, a CLI) registers the accessor first, in the root container,
   and keeps the current context in [`AsyncLocalStorage`](https://nodejs.org/api/async_context.html).
3. Services stay singletons and read the context when they use it.

For state that a request owns, such as a transaction or a per-request cache, see
[Per-request state](./request-state.md).

## Why not a fork

A service registered in the root container runs in the root (see [Forks](./containers.md#forks)), so it
can't depend on a `request` that a fork adds: in the root, the key is a type error and
[`INJECUTE_NOT_REGISTERED`](../errors/not-registered.md) at runtime. To use the request, every service
that needs it, and every service that depends on those, would have to be registered in the fork and
created again on every request. An isolated fork per request re-creates the whole graph.

With an accessor, the graph is built once, and each call reads the context of the request it runs in.

## The application declares what it needs

<<< @/../examples/request-context/app.ts#app

- The application owns the shape of `RequestContext`. Put in what your domain needs: tenant, user,
  locale, a deadline. injecute has no context type of its own.
- The application depends on the accessor, not on `AsyncLocalStorage`: it imports neither
  `node:async_hooks` nor HTTP types, and runs the same under any host.
- Services read the context **when they use it**. Reading it in a factory or constructor would keep the
  context of whichever request created the singleton (see [Pitfalls](#pitfalls)).

## The host provides it

<<< @/../examples/request-context/server.ts#host

The context is the host's first layer. `extend(addOrders)` is a type error when `context` is missing, so
an application module can't be added to a host that doesn't provide it (see
[Modules](./containers.md#modules)).

Each request runs inside `storage.run()`:

<<< @/../examples/request-context/server.ts#request

Everything the request calls sees its context, including code after `await` and in parallel promises.
Concurrent requests don't see each other's context.

A whole app on this pattern, with a logger and a tracer that read the context and feature modules in
namespaces: [open it in the playground](../playground?example=real-world).

### Queue consumers, cron jobs, CLI commands

Every entry point runs its work in `storage.run()`, so the application code is the same everywhere:

<<< @/../examples/request-context/server.ts#job

### Frameworks

Start the context in a middleware that runs before your handlers, and wrap the rest of the request with
`storage.run(context, next)`. The [framework pages](../frameworks/index.md) show where: [Express](../frameworks/express.md), [Fastify](../frameworks/fastify.md#request-context) (after
the body is parsed), [Hono](../frameworks/hono.md) and [Next.js](../frameworks/nextjs.md#request-context).

## Logging

[Pino](https://github.com/pinojs/pino/blob/main/docs/api.md#mixin-function)'s `mixin` runs on every log
line, so a singleton logger can add the current context:

```ts
import pino from 'pino';

const addLogger = (
  c: ServiceRegistry<{ context: ContextAccessor<RequestContext> }>,
) =>
  c.addSingleton(
    'logger',
    (context) =>
      pino({
        // return a new object on every call: pino merges into it
        mixin: () => ({ ...context.current() }),
      }),
    ['context'],
  );
```

A framework's request logger (Fastify's `request.log`) carries the request id, but only where you pass
the request. A logger that reads the context works in every service, including code that doesn't know it
runs in a request.

## Create long-lived services at startup

Timers, sockets and event listeners run in the context they were created in. A connection pool created
by the first request that needs it keeps that request's context (and keeps it in memory) for as long as
it lives:

<<< @/../examples/request-context/pitfalls.ts#startup

`await preload(app)` before the server starts listening creates every singleton outside any request.

## Pitfalls

**Don't resolve the context once.** A singleton that stores the context, or reads it in its factory or
constructor, keeps the first request's context for every later one:

<<< @/../examples/request-context/pitfalls.ts#captured

The same happens with a function dependency, `[() => storage.getStore()]`, on a singleton: it runs once,
when the singleton is created. Don't keep what you read in a field either; call `current()` each time.

**Use `run()`, not `enterWith()`.** `enterWith()` sets the context for the rest of the synchronous
execution, which can leak it into the next request. `run()` scopes it to a callback, and every runtime
that has `AsyncLocalStorage` supports it.

**Keep the context small.** Ids and plain values, not services. A service or a container in the context
is a dependency that no registration shows, and nothing disposes it.

**Work that outlives the request still sees its context.** A `setTimeout` or a fire-and-forget promise
started in a request keeps the request's context, and keeps it in memory. Copy the values it needs, or
start it with `storage.exit()`.

**Changing the context during a request.** Create the context when the request starts. When a later step
adds to it (authentication sets the user), let that step set a field of the context object. A nested
`storage.run({ ...storage.getStore()!, user }, next)` works too, but it starts a new context object, which
[one instance per request](./request-state.md#one-instance-per-request) treats as a new request.

## Beyond ambient data

The context carries data that many layers read. For state a request **owns** (a transaction, a
per-request cache, a per-tenant implementation), see [Per-request state](./request-state.md): a factory
with `using`, one instance per context or a strategy chosen by the context usually fit better than a
fork per request, and the guide has a table for choosing.

## Testing

Test the application with a fixed context, without `AsyncLocalStorage`:

<<< @/../examples/request-context/testing.ts#testing

To give a whole app container another context in a test, replace it in an isolated fork:
`app.fork({ isolated: true }).addInstance('context', fixed, { replace: true })`.

## Other runtimes

`AsyncLocalStorage` is available in Node.js, Deno, Bun and Cloudflare Workers (with Node.js
compatibility); use `run()` and `getStore()`, which all of them support. Browsers don't have it yet;
the TC39 [AsyncContext proposal](https://github.com/tc39/proposal-async-context) would add a standard
one. Only the host touches the storage, so moving to another one changes a single registration.
