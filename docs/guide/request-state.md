---
title: Per-request state
description: Patterns for state that belongs to one request (arguments, a unit of work, a context, one instance per request, resources released with the request, a strategy per tenant), and when a fork per request is still the right tool, with modules and tests for it.
---

# Per-request state

A fork per request is rarely the simplest way to handle state that belongs to one request. With forks:

- every request builds a container, and creates again the services registered in it;
- each service has to be registered in the right layer: services in the root can't depend on what a fork
  adds, so request state pulls every service that uses it, and every service that depends on those,
  into the fork;
- modules have to know which layer they are applied to;
- forks of forks and isolated forks make it hard to see where a service is created and who disposes it.

Most per-request state fits a plain design pattern, and the container helps to wire it. Try these
first, roughly in this order:

| Pattern                                                                    | For                                                                | The container's part                                           |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------- |
| [Pass it as an argument](#pass-it-as-an-argument)                          | Values of one operation: the order, the transaction                | None                                                           |
| [A factory and `using`](#a-factory-and-using-a-unit-of-work)               | Instances an operation creates and releases: a unit of work        | Registers the factory as a singleton, with its dependencies    |
| [A context accessor](./request-context.md)                                 | Data many layers read: the trace id, the tenant, the user          | Registers the accessor first, in the root                      |
| [One instance per request](#one-instance-per-request)                      | Lazy per-request instances: a cache, a DataLoader, an identity map | Registers a singleton that hands out one instance per context  |
| [Resources released with the request](#release-what-a-request-creates)     | A transaction several layers share in one request                  | Registers a singleton that hands out one resource per request  |
| [A strategy chosen by the context](#a-different-implementation-per-tenant) | A different implementation per tenant                              | Registers the implementations and the singleton that picks one |
| [A fork](#when-a-fork-is-the-right-tool)                                   | A group of per-request services the container wires and disposes   | Creates, wires and disposes the group                          |

In each of the first six, the services stay singletons in one container, built once at startup.

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
- Compared to [a fork](#when-a-fork-is-the-right-tool), the graph is built once, and every service is
  registered in the root and its modules. The cost: services that use the resource depend on
  `PerRequest<Transaction>` and call `current()`, so they know it belongs to a request.

## A different implementation per tenant

Instead of an isolated fork per tenant, register the implementations and a singleton that picks one for
the current tenant on every call (the Strategy pattern):

<<< @/../examples/request-context/strategy.ts#strategy

For per-tenant **resources**, such as a connection pool per tenant, keep them in a singleton map (one per
tenant) and create them at startup: a pool created lazily inside a request keeps that request's context
(see [Create long-lived services at startup](./request-context.md#create-long-lived-services-at-startup)).

## When a fork is the right tool

A fork is worth it when **several services** are created per request, share per-request instances,
and also depend on services of the app: the container then wires the group, which a hand-written
factory would repeat, and disposes it at the end:

<<< @/../examples/recipes/request-scope.ts#request-scope

[Open in the playground](../playground?example=recipes/request-scope)

Other good uses of forks:

- **Tests**: [isolated forks](./testing.md) replace a dependency for the whole graph.
- **Registrations for one part of the app only**: a plugin or a feature that registers its own services
  without changing the app's ([namespaces](./containers.md#namespaces) are forks too).
- **Runtimes without `AsyncLocalStorage`**, when passing the request explicitly would reach too many
  services.

When you use forks per request, keep them shallow: fork the root, in one place (the request handler or a
framework hook), register what the request owns with one module, and dispose the fork with
`await using`. Don't fork forks per request.

### Per-request registrations in modules

A module can't register per-request services in the root: the root would create them once, for every
request. Give a feature that owns per-request services two modules, one for the root and one for the
request's fork. The composition root applies the root modules; the request handler applies every
request module, in one place:

<<< @/../examples/recipes/request-modules.ts#request-modules

[Open in the playground](../playground?example=recipes/request-modules)

- The fork's singletons are the request's instances: each request gets its own `tx`, shared by
  `orders`, `payments` and `checkout`, and the fork disposes them. Other containers call this a scoped
  lifetime.
- The types keep the layers apart. A root module can't depend on a request service, because the root
  doesn't have its key, so no singleton keeps the first request's instance. `extend()` checks that the
  root provides what the request modules need.
- Don't register a request key in the root too (a default `tx`, say): root services that depend on it
  would keep the root's one. A request module that registers it then throws
  `INJECUTE_ALREADY_REGISTERED` and names those services (see
  [Overriding a parent's service in a fork](./containers.md#overriding-a-parent-s-service-in-a-fork)).
- A service that depends on a request service belongs in the request module too. Keep request modules
  small: what they register is created again in every request that uses it.

### Testing per-request services

<<< @/../examples/recipes/request-modules.ts#request-modules-test

- To replace a dependency of the root, build the handler from an isolated fork that replaces it. The
  request forks are forks of the isolated fork, so per-request services get the replacement.
- To replace a per-request service, let the handler take the request modules as a parameter, and pass
  them with the replacement applied after them, with `replace: true`.

## Choosing

| You need                                                                                       | Use                                                  |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| The trace id, tenant, user or locale in logs and services                                      | [a context accessor](./request-context.md)           |
| Request data in services registered in the root: domain services, repositories, the logger     | a context accessor                                   |
| The same application code under HTTP handlers, queue consumers, cron jobs and CLI commands     | a context accessor                                   |
| Data that changes during the request, like the user after authentication                       | a context accessor                                   |
| A value that one or two layers need                                                            | an argument                                          |
| A transaction, a checked-out connection or temporary files, released at the end                | a factory and `using`                                |
| State that several services share for one request only: a cache, a DataLoader, an identity map | one instance per request                             |
| A transaction or connection several layers share in one request, released at its end           | resources released with the request                  |
| A different implementation of a service per tenant                                             | a strategy chosen by the context                     |
| Per-tenant resources, like a pool per tenant                                                   | a singleton map, created at startup                  |
| Code that must never run outside a request                                                     | one instance per request (`current()` throws)        |
| Tests                                                                                          | a fixed accessor; isolated forks to replace services |
| Several per-request services that share instances and depend on the app's services             | a fork, disposed with `await using`                  |
| Per-request services of several features, with forks per request                               | a root module and a request module per feature       |
| A runtime without `AsyncLocalStorage`                                                          | arguments; a fork when they would reach too far      |
