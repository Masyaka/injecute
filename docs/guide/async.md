---
title: Async services
description: Services created asynchronously, in a DIContainer with defer() or in an AsyncDIContainer that awaits every dependency.
---

# Async services

There are two ways to work with services that are created asynchronously (connections, loaded config):

- **A few async services in a `DIContainer`**: factories may return promises, and `defer()` awaits them
  for the services that depend on them.
- **An `AsyncDIContainer`**, when much of the graph is async: every dependency is awaited before a
  factory runs, and every `get()` returns a promise.

## Async factories in a `DIContainer`

A factory can return a promise. A singleton caches that promise, so concurrent `get()` calls share one
creation. If the promise rejects, the container drops it and the next `get()` tries again; the rejection
is wrapped in [`INJECUTE_RESOLUTION_FAILED`](../errors/resolution-failed.md) with the resolution path.
`dispose()` releases the resolved value.

Services that depend on an async service receive the promise. `defer()` wraps a factory so its promised
arguments are awaited first:

<<< @/../examples/async-dependencies.ts#defer

`get()` of a deferred service returns a promise; await it where you use it, or resolve the async
services once at startup:

```ts
const [db, cache] = await Promise.all([app.get('db'), app.get('cache')]);
```

## `AsyncDIContainer`

An `AsyncDIContainer` awaits every dependency before it calls a factory, so factories and classes receive
resolved values, without `defer()`. Its service types are the resolved types: a factory returning
`Promise<Config>` registers a `Config`. Every resolution returns a promise:

<<< @/../examples/async-container.ts#container

It has the same API as `DIContainer`, with these differences:

- `get()`, `call()`, `injecute()`, `bind()` functions and `createResolver()` functions return promises.
  A missing key rejects instead of throwing.
- Singletons behave like async singletons in a `DIContainer`: created once under concurrent `get()`
  calls, retried after a failure, disposed once resolved.
- Forks of an async container are async too, including `fork({ isolated: true })`.

### Modules and consumers

A module for an async container takes an `AsyncServiceRegistry`, and code that only resolves services
takes an `AsyncServiceProvider`. They mirror [`ServiceRegistry` and `ServiceProvider`](./containers.md),
with promises from `get()`:

<<< @/../examples/async-container.ts#modules

Sync and async types don't mix: a module typed `ServiceRegistry` can't be applied to an async container,
and an async container can't be passed where a `ServiceProvider` is expected, because their `get()`
returns values, not promises.

### Tests

Override services in an isolated fork, as with a `DIContainer` ([Testing](./testing.md)). A replacement
can be a value or a promise:

<<< @/../examples/async-container.ts#testing

### Startup and shutdown

`preload()` returns a promise that settles once every service is created; await it at startup. To run
work at startup (migrations, consumers, listening) and stop it in reverse, use
[lifecycle hooks](./startup-shutdown.md): `startLifecycle()` awaits each hook, including in an async container.
`dispose()` waits for singletons that are still being created, then releases them:

<<< @/../examples/async-container.ts#startup

### Middlewares, events and utilities

- A middleware's `next()` returns a promise for services a factory creates (instances added with
  `addInstance()` pass through as they are). A middleware that measures or wraps values should await it:

  ```ts
  app.use(async (key, next) => {
    const start = performance.now();
    const value = await next();
    console.debug(`${String(key)}: ${performance.now() - start}ms`);
    return value;
  });
  ```

- The `value` of `get` and `produce` events may be a promise.
- `preload()` and `buildServicesGraph()` accept an async container. `createProxyAccessor()`,
  `createNamedResolvers()`, `createResolversTuple()` and `setCacheInstance()` are for `DIContainer`; use
  `createResolver()` and isolated forks instead.

## Which one to use

| Situation                                                    | Use                                            |
| ------------------------------------------------------------ | ---------------------------------------------- |
| Mostly sync services, one or two async ones (config, a pool) | `DIContainer` + `defer()`, or resolve at start |
| Much of the graph depends on async services                  | `AsyncDIContainer`                             |
| Code that must call `get()` synchronously                    | `DIContainer`                                  |
