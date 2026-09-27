---
title: Containers, forks and modules
description: Request scopes with fork(), isolated forks for tests, modules with extend(), and namespaces.
---

# Containers, forks and modules

## Forks

`fork()` creates a child container. The child sees every service of its parent, including ones the
parent registers later. What you add to the child stays in the child.

<<< @/../examples/containers.ts#fork

[Open in the playground](../playground?example=containers)

A service registered in the parent **runs in the parent** and is shared by all forks. That is what you
want for request scopes: the database pool is created once, the request stays per request.

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

`get('Reports')` returns a read-only provider of the namespace.

## Which one to use

| You want to…                                                       | Use                        |
| ------------------------------------------------------------------ | -------------------------- |
| add request-specific services next to shared ones                  | `fork()`                   |
| replace a dependency for everything, without touching the original | `fork({ isolated: true })` |
| split registrations by feature                                     | modules with `extend()`    |
| group services under a name, e.g. `Billing.*`                      | `namespace()`              |
