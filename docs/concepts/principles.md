---
title: Design principles
description: The principles injecute is built on, what they mean for your code, their known exceptions, and the design tests a new feature has to pass.
---

# Design principles

This page explains how injecute behaves and why, so you can predict it. The second part lists the tests
a new feature has to pass, so the library keeps the same direction as it grows.

## Principles

### 1. Explicit wiring

Every registration lists the keys it depends on, next to the factory:
`addSingleton('users', UserRepository, ['db'])`.

**For you:** the wiring is in one place and readable without running anything. Nothing is matched by
name, type or position behind your back.

### 2. No decorators, no reflection

Your classes and functions don't import the container, carry metadata or depend on parameter names.

**For you:** they stay plain TypeScript, testable without a container, and work without build-time
transforms. Adopting or removing injecute doesn't touch them.

### 3. Typed from the registrations

The container's type grows with every registration: `get()` results and factory parameters are inferred,
and a wrong key, a missing service or (under a [tag](../guide/tags.md)) a wrong contribution is a compile
error.

**For you:** annotate little, and trust the errors. See [TypeScript](../guide/typescript.md).

### 4. Lazy unless a function says otherwise

Registering runs nothing. A service is created when something resolves it.

**For you:** registering creates nothing, and unused services cost nothing. Eager work is
explicit and named: `preload()` resolves services at startup, and `startLifecycle()` runs
[lifecycle hooks](../guide/startup-shutdown.md).

### 5. The container that runs a factory owns the instance

A service registered in a parent runs and is cached in the parent; an
[isolated fork](../guide/containers.md#isolated-forks) runs everything itself. See
[How resolution works](./resolution.md).

**For you:** forks share the app's singletons, and isolated forks replace a dependency for the whole graph
in tests, without touching the app.

### 6. Each place gets only the part it needs

Consumers get a `ServiceProvider` (resolve), modules a `ServiceRegistry` (resolve and register), and only
the composition root the `DIContainer` (configure, fork, dispose). See [Roles](./roles.md).

**For you:** handlers can't rewire the app, and modules can't take over its configuration.

### 7. Modules only register

A module function registers services and returns. Work at startup is a
[lifecycle hook](../guide/startup-shutdown.md); contributions to another module go under a
[tag](../guide/tags.md).

**For you:** a module behaves the same in the app and in a test fork, because it does nothing on its own.

### 8. Keys are names

A key means nothing beyond the service it names, except for two reserved forms: `Ns.key` for
[namespaces](../guide/containers.md#namespaces) and `name:tag` for [tags](../guide/tags.md) and lifecycle
stages. See [Reserved key forms](../guide/registration.md#reserved-key-forms).

**For you:** build reserved keys with their helpers (`namespace()`, `route('name')`,
`lifecycle.start('name')`) instead of typing them.

### 9. Resolution follows dependencies

Which service is created first follows the dependency graph, not the order of registrations. Two
documented exceptions use registration order: `collect(tag)` results and the hooks of a lifecycle stage.
See [Order](./resolution.md#order).

**For you:** when order matters for correctness, express it with a dependency or a stage.

### 10. Owns what it creates

The container releases the singletons it created, dependents first, with `dispose()` or `await using`. A
running app is stopped before its resources are released: `running.stop()` undoes the lifecycle hooks in
reverse, then disposes. See [Lifecycle and dispose](../guide/lifecycle.md).

**For you:** close connections and stop servers by disposing, not by tracking them yourself.

### 11. Errors say how to fix them

Every error is an `InjecuteError` with a stable `code` (one code, one meaning), the resolution `path` and
a link to its [page](../errors/index.md).

**For you:** branch on `error.code`, never on the message.

### 12. A small API, one recommended way per task

Each task has one default way, and the docs lead with it. Where two ways exist, the docs say which one is
the default and when to use the other.

**For you:** the first example in a guide is the one to copy.

### 13. Runs everywhere

ES modules for Node.js, Deno, Bun and browsers, no runtime dependencies, no build step required. See
[Without a build step](../guide/no-build.md).

### 14. Stable, including types

Semantic versioning covers the runtime and the types, and the cost of type checking is kept in a budget.
See [Versioning and support](../guide/versioning.md).

**For you:** a minor version doesn't break your code or your types, and large containers stay fast to
typecheck.

## Exceptions

Places where injecute bends a principle on purpose. Each one is documented where it applies.

| Principle                     | Exception                                                                                          | Why                                                                      |
| ----------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 8. Keys are names             | `name:tag` keys: `collect()` gathers them, and `startLifecycle()` runs and validates them as hooks | extension points and hooks without a registry API, typed through tags    |
| 9. Resolution follows deps    | `collect(tag)` results and the hooks of one stage come in registration order (the root's first)    | an order that is predictable, without priorities                         |
| Keeping the direction, test 6 | `setCacheInstance()`, the lifecycle and `buildServicesGraph()` use internal container symbols      | they need state the public API doesn't expose                            |
| Keeping the direction, test 7 | `startLifecycle()` remembers each container's run outside the container                            | a running lifecycle is not a service, and must not be reset by `reset()` |

## Keeping the direction

Written for maintainers of injecute: the tests a new feature or change has to pass. A change that bends
one of the principles names it in its pull request and adds a row to [Exceptions](#exceptions), so the
exception is a decision, not an accident.

1. **Explicit and plain.** It works with plain classes and functions and explicit keys: no decorators,
   no reflection, no matching by parameter name (1, 2).
2. **Typed end to end.** Its types are inferred from the registrations; mistakes are compile errors with a
   readable message; it has type tests, and the type benchmark stays within budget (3, 14).
3. **Lazy by default.** It creates nothing on registration. Eager behaviour is a function whose name
   says so (4).
4. **Fits the forks.** It behaves correctly in a fork and an isolated fork: it resolves in the container
   that runs the factory, and test overrides reach it (5).
5. **Respects the roles.** Modules get no more than a `ServiceRegistry`; only the composition root
   configures and owns the lifecycle (6, 7).
6. **Built on the public API.** A utility uses the public API. When it needs container internals, it uses
   an internal symbol and is listed in [Exceptions](#exceptions).
7. **State lives in containers.** What a feature remembers belongs to a container, so `reset()`, forks
   and `dispose()` handle it, unless it is listed in [Exceptions](#exceptions).
8. **No new meaning in keys** beyond the reserved forms; a new form is an exception (8).
9. **No hidden ordering.** Behaviour doesn't depend on registration order, unless it is documented in
   [Order](./resolution.md#order) (9).
10. **Releases what it starts.** Anything it starts can be stopped, in reverse, before resources are
    released (10).
11. **One error code, one meaning.** A new failure gets its own code, with a hint and a page (11).
12. **One way per task.** It doesn't add a second way to do something the API already does; if it does,
    the docs name the default (12).
13. **No runtime dependencies**, nothing tied to one runtime, and it runs without a build step (13).
14. **Semver for types too.** Widening a type the API returns, or narrowing one it accepts, is a
    breaking change (14).
