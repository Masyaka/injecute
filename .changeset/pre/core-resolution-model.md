---
'injecute': major
---

**New resolution core.** Registrations are plain data and the container that runs a factory owns its result.

- `null` and `undefined` are valid service values (0.x threw "No service registered"). [Migration](https://masyaka.github.io/injecute/migration/0.x-to-1.0#null-and-undefined-are-valid-service-values)
- A dependency on the key being registered resolves the previous definition, so a child can decorate a parent service: `fork().addSingleton('logger', (l) => wrap(l), ['logger'])`. [Migration](https://masyaka.github.io/injecute/migration/0.x-to-1.0#decorating-a-service-with-a-self-dependency)
- Middlewares run once per `get()` instead of once per container level.
- `extend()` accepts extensions that return a child container, as documented.
- `keys` lists overridden keys once; `fork()` keeps the container subclass; registration no longer mutates the `dependencies` array you pass; the circular-dependency check is linear instead of exponential.
- **Removed:** `flatten()` (use `fork({ isolated: true })`), `getFactory()`, `entryTypeKey`, `firstResult`, the `EntryType` type (now `RegistrationKind`) and the `beforeResolving` / `afterResolving` / `beforeReplaced` options. New: `getRegistration(key)`. The `replace` event reports `previous: RegistrationInfo`. [Migration](https://masyaka.github.io/injecute/migration/0.x-to-1.0#flatten-is-removed)
