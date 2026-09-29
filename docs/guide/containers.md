---
title: Containers, forks and modules
description: Forks, isolated forks for tests, modules with extend(), and namespaces.
---

# Containers, forks and modules

## Forks

`fork()` creates a child container. The child sees every service of its parent, including ones the
parent registers later. What you add to the child stays in the child.

<<< @/../examples/containers.ts#fork

[Open in the playground](../playground?example=containers)

A service registered in the parent **runs in the parent** and is shared by all forks: the database pool
is created once, and what a fork adds stays in the fork. Parent services can't depend on what a fork
adds.

::: tip Before you fork per request
Forks per request make the container structure harder to follow: each service must be registered in the
right layer, and request state pulls the services that use it into the fork. Request data (the trace id,
the tenant, the user) fits a [context accessor](./request-context.md), and state a request owns usually
fits an argument, a factory with `using` or one instance per context. See
[Per-request state](./request-state.md).
:::

It also means that overriding a dependency in a fork does not change parent services that already
depend on it. For that, use an isolated fork.

## Isolated forks

`fork({ isolated: true })` runs **every** service it resolves inside the fork, including services
registered in its parents. Overrides then reach the whole graph, and nothing leaks back into the parent.

<<< @/../examples/containers.ts#isolated

Use isolated forks for tests and for per-tenant variants of an app container. Namespaces are re-created
inside the fork, and forks of an isolated fork share its instances.

## Modules

A module is a plain function that registers services. It receives a
[`ServiceRegistry`](../concepts/roles.md): it can register, but not add middlewares, fork or dispose.
Declare only the services the module needs; `extend()` checks that the container has them.

<<< @/../examples/containers.ts#modules

If a required service is missing, the error names it:

```text
Argument of type '(c: ServiceRegistry<{ db: Database; }>) => …' is not assignable to parameter of type
'{ 'injecute: extension requires services that are not registered': "db"; }'.
```

## Namespaces

`namespace(name, callback)` groups the services a callback registers under a prefix. The callback
receives a fork of the container, so it can use every service registered there.

<<< @/../examples/containers.ts#namespaces

`get('Reports')` returns a read-only provider of the namespace. In the container's service map
(`ContainerServices<typeof app>`), `Reports` is a `Namespace` marker next to the `Reports.*` keys;
`NamespaceServices<typeof app, 'Reports'>` gives the namespace's services.

## Sealing the composition root

`seal()` ends the registrations of a container: afterwards `add*`, `namespace()` and `extend()` throw
`INJECUTE_SEALED`, and its type has no registration methods. Resolving, middlewares, events, `reset()`
and `dispose()` keep working, and forks are open, so request scopes and tests fork the sealed root.

<<< @/../examples/containers.ts#seal

A sealed container's type is also cheaper for TypeScript: its service map is one object instead of an
intersection of every registration, so forks and request scopes built on it typecheck faster and show
readable types (see [TypeScript](./typescript.md#seal-the-composition-root)).

## Which one to use

| You want to…                                                       | Use                                         |
| ------------------------------------------------------------------ | ------------------------------------------- |
| give services the trace id, tenant or user of the current request  | a [context accessor](./request-context.md)  |
| keep state that belongs to one request, like a transaction         | see [Per-request state](./request-state.md) |
| replace a dependency for everything, without touching the original | `fork({ isolated: true })`                  |
| split registrations by feature                                     | modules with `extend()`                     |
| group services under a name, e.g. `Billing.*`                      | `namespace()`                               |
