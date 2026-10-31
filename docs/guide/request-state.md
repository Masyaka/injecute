---
title: Scoped state
description: State that belongs to one unit of work (a session, a request, a transaction, a job) - scopes with their own services, and patterns that keep every service in the root (arguments, a unit of work, a context, one instance per context, resources released at the end, a strategy per tenant), with a table for choosing.
---

# Scoped state

Some state belongs to one unit of work: a user session, a request, a transaction, a queue job. There are
two ways to give it to services, and this page compares them:

- **A scope:** a fork for the unit of work, with services of its own. Its services may depend on the
  root's; the root's never depend on a scope's.
- **Patterns that keep every service in the root:** the root is built once, and the state reaches the
  services as an argument, through a context, or through a singleton that hands out one instance per
  unit of work.

| Option                                                                     | For                                                                                    | The container's part                                           |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| [A scope](#scopes)                                                         | Several services that belong to the unit of work, share its instances and use the root | Creates, wires and disposes the scope's services               |
| [Pass it as an argument](#pass-it-as-an-argument)                          | Values of one operation: the order, the transaction                                    | None                                                           |
| [A factory and `using`](#a-factory-and-using-a-unit-of-work)               | Instances an operation creates and releases: a unit of work                            | Registers the factory as a singleton, with its dependencies    |
| [A context accessor](./request-context.md)                                 | Data many layers read: the trace id, the tenant, the user                              | Registers the accessor first, in the root                      |
| [One instance per context](#one-instance-per-request)                      | Lazy instances per unit of work: a cache, a DataLoader, an identity map                | Registers a singleton that hands out one instance per context  |
| [Resources released at the end](#release-what-a-request-creates)           | A transaction several layers share, released when the work ends                        | Registers a singleton that hands out one resource per context  |
| [A strategy chosen by the context](#a-different-implementation-per-tenant) | A different implementation per tenant                                                  | Registers the implementations and the singleton that picks one |

What each costs:

- **A scope** creates its services again for every unit of work, and a service that depends on a scope
  service belongs in the scope too. In return its services take the scoped state as ordinary
  dependencies, and the scope disposes them.
- **The patterns** build the graph once, but the services that use the state know that it is scoped:
  they take it as an argument or read it through `current()`.

[Choosing](#choosing) at the end lists common needs with the option that fits each.

## Scopes

A scope is a fork for one unit of work. Several services that belong to it share its instances and use
the root's services; the scope wires them and disposes them when the work is done:

<<< @/../examples/recipes/request-scope.ts#request-scope

[Open in the playground](../playground?example=recipes/request-scope)

- The scope's singletons are the unit of work's instances: one `tx` here, shared by `orders` and
  `payments`, and rolled back by `await using` unless it was committed.
- The direction is fixed. A scope's services may depend on the root's; a root service can't name a key
  that only a scope registers, so no singleton keeps the first scope's instance. Other containers call
  this a scoped lifetime.
- Create the scope in one place (the handler, the job runner, a framework hook) and dispose it with
  `await using`.
- A scope can decorate a root service for its own services, such as a logger with the request id: see
  [Decorating a root service in a scope](./containers.md#decorating-a-root-service-in-a-scope).

A root service that names a scope's key doesn't compile; the error points at the key:

```ts
new DIContainer()
  .addSingleton('db', Database)
  .addSingleton('report', (tx) => tx, ['tx']);
// error: Type '"tx"' is not assignable to type 'Dependency<{}, { db: Database; }>'.
```

Scopes also fit work without `AsyncLocalStorage` (some edge runtimes), where passing the state
explicitly would reach too many services.

### Scope modules

A module can't register scoped services in the root: the root would create them once, for every unit of
work. Give a feature with scoped services two modules, one for the root and one for the scope. The
composition root applies the root modules; the place that creates the scope applies every scope
module:

<<< @/../examples/recipes/request-modules.ts#request-modules

[Open in the playground](../playground?example=recipes/request-modules)

- The types keep the two apart: a scope module declares the root services it needs
  (`ServiceRegistry<{ db: Database; gateway: Gateway }>`), and `extend()` checks that the root provides
  them.
- Don't register a scope's key in the root too (a default `tx`, say): root services that depend on it
  would keep the root's one. A scope module that registers it then throws `INJECUTE_ALREADY_REGISTERED`
  and names those services (see
  [Overriding a parent's service in a fork](./containers.md#overriding-a-parent-s-service-in-a-fork)).
- A service that depends on a scope service belongs in the scope module too. Keep scope modules small:
  what they register is created again in every scope that uses it.

### Testing scoped services

<<< @/../examples/recipes/request-modules.ts#request-modules-test

- To replace a dependency of the root, build the handler from an isolated fork that replaces it. The
  scopes are forks of the isolated fork, so their services get the replacement.
- To replace a scoped service, let the handler take the scope modules as a parameter, and pass them with
  the replacement applied after them, with `replace: true`.
- [`checkWiring()`](./testing.md#check-the-wiring) on a scope built in the test checks the scope
  modules too.

## Pass it as an argument

The simplest per-request state is a parameter. When one or two layers need a value, pass it:

```ts
class OrderRepository {
  insert(tx: Transaction, order: Order) {
    tx.query('insert into orders …', order);
  }
}
```

The dependency is visible in the types, tests pass what they need, and there is nothing to scope.
Move to another pattern when the same value is threaded through many layers only to reach a few
places.

## A factory and `using`: a unit of work

When an operation creates something and must release it (a transaction, a checked-out connection,
temporary files), register a **factory** and let the caller own what it creates. With
[`using`](https://github.com/tc39/proposal-explicit-resource-management), the instance is disposed at
the end of the block, also when it throws:

<<< @/../examples/recipes/unit-of-work.ts#unit-of-work

[Open in the playground](../playground?example=recipes/unit-of-work)

- `Checkout` and the factory are singletons. The unit of work lives in one method call, not in a
  container.
- The factory is a service like any other: it gets its dependencies from the container, and tests can
  replace it.
- The unit of work groups what the operation needs (repositories bound to the transaction), so they are
  not passed one by one.

## One instance per request

A per-request cache, a [DataLoader](https://github.com/graphql/dataloader) or an identity map is created
on first use and shared by everything in the request. Keep it in a singleton that hands out one
instance per [context](./request-context.md):

<<< @/../examples/request-context/per-request.ts#per-context

<<< @/../examples/request-context/per-request.ts#per-request

- The context object is the key: create a new object for each request (`storage.run({ … }, …)`). The
  `WeakMap` forgets the instances with the context. A nested `storage.run({ ...context, user }, …)`
  starts a new key, and so new instances: to add to the context during a request, set a field instead.
- Outside a request, `current()` throws, so code that needs a request fails loudly instead of sharing
  one instance.
- The instances are not disposed. For instances that must be released, use a factory and `using`, or
  [release them with the request](#release-what-a-request-creates).
- For DataLoaders that only resolvers use, a GraphQL server's per-request context is enough: see
  [GraphQL](../frameworks/graphql.md).

## Release what a request creates

A transaction that several layers share in one request is opened by the first one that needs it, and
must be released when the request ends, also when it fails. One instance per request handles the
sharing. The request's resources handle the release:

<<< @/../examples/recipes/request-resources.ts#resources

<<< @/../examples/recipes/request-resources.ts#request-resources

[Open in the playground](../playground?example=recipes/request-resources)

- The host owns the request, so it owns what the request creates: `await using resources` releases it
  after the handler, the last one first, also when the handler throws. The services stay singletons,
  and `dispose()` still releases the app.
- A resource is created on first use: a request that never touches `tx` opens no transaction.
- A failing release doesn't stop the others; the errors are thrown together, as an `AggregateError`.
- Don't use a request's resources in work that outlives the request, like a timer or a background job:
  they are released when the request ends.
- Where `AsyncDisposableStack` is available (Node.js 24 and later), it can replace `RequestResources`:
  `resources.use(create())`.
- Compared to [a scope](#scopes), the graph is built once, and every service is
  registered in the root and its modules. The cost: services that use the resource depend on
  `PerRequest<Transaction>` and call `current()`, so they know it belongs to a request.

## A different implementation per tenant

Instead of an isolated fork per tenant, register the implementations and a singleton that picks one for
the current tenant on every call (the Strategy pattern):

<<< @/../examples/request-context/strategy.ts#strategy

For per-tenant **resources**, such as a connection pool per tenant, keep them in a singleton map (one per
tenant) and create them at startup: a pool created lazily inside a request keeps that request's context
(see [Create long-lived services at startup](./request-context.md#create-long-lived-services-at-startup)).

## Choosing

| You need                                                                                       | Use                                                                                          |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Several services that belong to a session, request, transaction or job and share its state     | [a scope](#scopes), disposed with `await using`                                              |
| Scoped services in several features                                                            | a root module and a [scope module](#scope-modules) per feature                               |
| A scope's services with a decorated root service, like a logger with the request id            | [a decoration in the scope](./containers.md#decorating-a-root-service-in-a-scope)            |
| The trace id, tenant, user or locale in logs and services                                      | [a context accessor](./request-context.md)                                                   |
| Request data in services registered in the root: domain services, repositories, the logger     | a context accessor                                                                           |
| The same application code under HTTP handlers, queue consumers, cron jobs and CLI commands     | a context accessor, or the same scope modules in each host                                   |
| Data that changes during the work, like the user after authentication                          | a context accessor                                                                           |
| A value that one or two layers need                                                            | an argument                                                                                  |
| A transaction, a checked-out connection or temporary files, released at the end                | a factory and `using`, or a scope                                                            |
| State several root services share for one unit of work: a cache, a DataLoader, an identity map | one instance per context                                                                     |
| A transaction several root services share, released at the end                                 | resources released at the end                                                                |
| A different implementation of a service per tenant                                             | a strategy chosen by the context                                                             |
| Per-tenant resources, like a pool per tenant                                                   | a singleton map, created at startup                                                          |
| Code that must never run outside a unit of work                                                | a scope (the key doesn't exist outside it), or one instance per context (`current()` throws) |
| Tests                                                                                          | a fixed accessor; isolated forks to replace services                                         |
| A runtime without `AsyncLocalStorage`                                                          | arguments, or a scope                                                                        |
