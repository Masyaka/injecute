# Roadmap

Ideas and candidates for releases after 1.0. Nothing here is a commitment.
Open an issue to discuss any of them before starting work.

## Candidates after 1.0

- **`decorate()` hook.** Wrap a produced instance once, when it is created, and cache the wrapped value with the instance. Today decoration uses "replace with a self-dependency" for a single key.
- **Per-service dependency overrides.** Override some dependencies of one service without an isolated fork.
- **`snapshot()`.** A container detached from later parent registrations (copy-based), for the rare case where `fork({ isolated: true })` seeing new parent registrations is not wanted.
- **Runtime-restricted facades.** `asProvider()` / `asRegistry()` returning objects that expose only the matching methods, for untrusted plugin code. The 1.0 roles are compile-time only.
- **Lazy wrappers.** A wrapped function that does not resolve anything from the container before it is called.
- **Memoized transients.** Return a new instance only when a dependency changed, without checking every dependency on each `get`.
- **Singleton lifetime (TTL).** Drop a cached singleton after a time limit.
- **Config-driven wiring.** Choose implementations from JSON/YAML, for example:

  ```json
  {
    "logger": "winstonLogger",
    "notificationService": "slackNotificationService"
  }
  ```

- **TC39 decorators.** Optional decorator support, with the decorators resolved from the container.
- **Automatic dependency keys from TypeScript types.** Generate dependency keys with a TypeScript transformer.
- **Playground share links for issue reports.** (Planned for the 1.0 docs if the sandbox work lands in time.)

## Done or superseded

- Async dependencies: `defer()` exists; a dedicated async container is being designed.
- Optional dependency keys: replaced by `optional(key)` in 1.0.
- Dedicated utils to list services and their dependencies: `keys`, `getRegistration()` and `buildServicesGraph()`.
- Dispose / utilization on reset: `dispose()` and `[Symbol.asyncDispose]` in 1.0.
- Splitting the container interface into "adding" and "utilities" parts: `ServiceProvider` / `ServiceRegistry` / `DIContainer` in 1.0.

## Covered differently

- **Scoped lifetime** (a lifetime flag on a service registered in the root, so each fork gets its own
  instance). [Scopes](docs/guide/request-state.md#scopes) cover it explicitly: a scope is a fork with
  its own services, registered by a [scope module per feature](docs/guide/request-state.md#scope-modules),
  and a root service can't depend on a scope's service, which the types check without any lifetime
  tracking. A lifetime flag would bend principle 5 (the container that runs a factory owns the
  instance), need a new error and lifetime tracking in the types for a singleton that depends on a
  scoped service, and add a second way to register scoped services (test 12).
