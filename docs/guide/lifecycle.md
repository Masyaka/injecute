---
title: Lifecycle and dispose
description: Release connections and other resources with dispose() and await using, in reverse creation order.
---

# Lifecycle and dispose

`await container.dispose()` releases every instance the container **owns**, dependents first, then marks
the container as disposed.

<<< @/../examples/lifecycle.ts#dispose

[Open in the playground](../playground?example=lifecycle)

## What the container owns

- **Singletons it created.** Each is disposed with its registration's `dispose` function, or with
  `[Symbol.asyncDispose]` / `[Symbol.dispose]` when the instance has one. `dispose: false` opts out.
  When a factory returns a promise, the resolved value is disposed (a singleton still being created is
  awaited first); one whose promise rejected is skipped.
- **`addInstance` values registered with `{ dispose: true }` (or a function).** Values you add are yours
  by default.
- **Namespace containers**, with their services.

Transients are never tracked: the caller owns them. A `dispose` option on a transient throws
[`INJECUTE_INVALID_OPTION`](../errors/invalid-option.md).

## Order and failures

Instances are disposed in **reverse creation order** across the container and its namespaces, so a
service is released before the services it depends on. If some disposers fail, the others still run, and
`dispose()` rejects with [`INJECUTE_DISPOSE_FAILED`](../errors/dispose-failed.md) (the failures are in
`cause`, an `AggregateError`). Calling `dispose()` again returns the same promise.

## Scopes with `await using`

Containers implement `[Symbol.asyncDispose]`, so a fork can be disposed at the end of a block:

<<< @/../examples/lifecycle.ts#await-using

A parent does not dispose its forks: dispose each fork you create (`await using` does that for you).

## `reset()` vs `dispose()`

`reset()` clears cached instances so they are created again on the next resolution. It does not dispose
them; `dispose()` still releases every instance the container created, including ones `reset()` or
`replace` dropped.
