---
'injecute': minor
---

**`AsyncDIContainer`.** A container for graphs with async services: every dependency is awaited before a factory runs, so factories and classes receive resolved values without `defer()`, and a factory returning `Promise<T>` registers `T`. `get()`, `call()`, `injecute()` and resolvers return promises (a missing key rejects instead of throwing). Forks stay async, singletons are created once under concurrent resolutions and retried after a failure, and `dispose()` releases resolved instances. Modules for it take the new `AsyncServiceRegistry`, consumers the new `AsyncServiceProvider`; the sync `ServiceRegistry` / `ServiceProvider` types don't accept it. `buildServicesGraph()` and `preload()` accept async containers. See [Async services](https://masyaka.github.io/injecute/guide/async).
