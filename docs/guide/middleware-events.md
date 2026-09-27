---
title: Middlewares and events
description: Wrap resolution with middlewares (tracing, fallbacks, deprecations, guards, test doubles) and observe containers with events.
---

# Middlewares and events

A **middleware** wraps every resolution: it can time it, change it, or answer for keys that are not
registered. An **event listener** only observes. Reach for events first.

## Rules

- `use(middleware)` adds a middleware; `unuse(middleware)` removes it. The last added runs first.
- A middleware receives `(key, next, context)`. Call `next()` to continue, `next(otherKey)` to resolve
  another key. `context` has `container` (read-only), `path` (keys being resolved) and `depth`.
- The chain runs **once per `get()`**, including for nested dependencies (with a higher `depth`).
- Forks **inherit** their ancestors' middlewares live: one added to the parent later applies to existing
  forks. `fork({ middlewares: false })` opts out.
- Dependencies of a service registered in a parent are resolved **in the parent**, through the parent's
  middlewares (the parent owns that instance). In an [isolated fork](./containers.md#isolated-forks) they
  are resolved in the fork.

## Tracing and timing

<<< @/../examples/middleware/tracing.ts#tracing

## Fallbacks and dynamic keys

<<< @/../examples/middleware/fallback.ts#fallback

Keys a middleware provides are not in the container's type. When the values are known up front, a
registration is simpler and typed.

## Keeping renamed keys working

<<< @/../examples/middleware/deprecation.ts#deprecation

## Guards

<<< @/../examples/middleware/guards.ts#guards

## Test doubles

<<< @/../examples/middleware/test-doubles.ts#test-doubles

To replace a dependency for a whole graph, an [isolated fork](./testing.md) is usually clearer.

## When not to use a middleware

- **Decorating instances** (wrapping a service in a proxy): a middleware runs on every `get()`, so it
  would return a new wrapper each time and break singleton identity. Decorate with a
  [self dependency](./registration.md#decorating-a-service) instead.
- **Observing**: use events.

## Events

<<< @/../examples/events.ts#events

| Event     | When                                          | Payload                                               |
| --------- | --------------------------------------------- | ----------------------------------------------------- |
| `add`     | a registration is added or replaced           | `key`, `replace`, `kind`, `container`                 |
| `replace` | a registration is replaced                    | `key`, `previous` (a `RegistrationInfo`), `container` |
| `reset`   | `reset()` cleared cached instances            | `keys`, `resetParent`, `container`                    |
| `get`     | a service is resolved (also for dependencies) | `key`, `value`, `container`                           |
| `produce` | a factory created an instance                 | `key`, `value`, `container`                           |
| `dispose` | `dispose()` finished                          | `container`                                           |

`container` is a read-only view of the container that emitted the event.
