---
'injecute': minor
---

**`seal()`.** `app.seal()` ends the registrations of a container: afterwards `add*`, `namespace()` and `extend()` throw the new `INJECUTE_SEALED` error, and the returned type (`SealedDIContainer` / `SealedAsyncDIContainer`) has no registration methods. Resolving, middlewares, events, `reset()` and `dispose()` keep working, and forks stay open, so request scopes and tests fork the sealed root. The sealed type holds the services as one object instead of an intersection of every registration, so forks built on it typecheck about 25% faster and hovers stay readable. See [Sealing the composition root](https://masyaka.github.io/injecute/guide/containers#sealing-the-composition-root).
