---
title: How resolution works
description: Lookup through parent containers, which container runs a factory and owns the instance, decoration, middlewares, cycles and errors.
---

# How resolution works

## Lookup

`get(key)` looks for a registration of `key` in the container, then in its parent, and so on. The first
registration found wins, so a fork can override a parent's service by registering the same key.

## Who runs the factory, and who owns the instance

The container that **runs** a factory also **caches** the result (for singletons) and **owns** it (for
`dispose()`).

- For a normal fork, a service registered in the parent runs in the parent. Its instance is shared by all
  forks, and its dependencies are resolved in the parent.
- For an isolated fork (`fork({ isolated: true })`), every service resolved through the fork runs in the
  fork, even when it is registered in a parent. Its dependencies are resolved in the fork, so overrides
  in the fork apply.

Caches are kept per registration: replacing a registration starts a new cache entry, and the previous
instance is still disposed by `dispose()`.

## Order

Resolution follows dependencies, not registration order, with two exceptions where registration order
is the order you get:

- **`collect(tag)`** returns the services under the tag in registration order, the root's first, then
  what forks below it added. A namespace's services come where `namespace()` was called.
- **Lifecycle hooks** of one stage run in that order too (unless the stage is concurrent), and are
  undone in reverse.

So the order of `extend()` and `namespace()` calls in the composition root decides, for example, the
order of routes and of hooks. When the order matters for correctness, express it with stages (or with
a dependency), not with the order of the calls.

## Decoration

A dependency on the key being registered is resolved to the **previous definition** of that key: the
registration it replaces in the same container, or the parent's registration in a fork. Without a
previous definition, registering it throws
[`INJECUTE_NO_PREVIOUS_DEFINITION`](../errors/no-previous-definition.md).

## Middlewares

A `get()` runs the effective middleware chain once: the ancestors' middlewares (root first) followed by
the container's own, with the last added running first. Nested dependencies go through the chain of the
container that runs their factory, with a higher `context.depth`.

## Cycles

Registration checks the dependency graph and throws
[`INJECUTE_CIRCULAR_DEPENDENCY`](../errors/circular-dependency.md) when a new registration closes a
cycle, including cycles through services registered later. Resolution also guards against cycles that
only appear at runtime.

## Errors

Every error is an `InjecuteError` with a `code`, the resolution `path` and a `docs` link. Errors thrown
by your factories are wrapped as
[`INJECUTE_RESOLUTION_FAILED`](../errors/resolution-failed.md) with the original error as `cause`, so the
message says which service needed the one that failed.
