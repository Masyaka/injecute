---
'injecute': major
---

**Middlewares: `(key, next, context)`.** Middlewares no longer get the container as `this` (arrow functions work); `context` carries `container`, the resolution `path` and `depth`. `next()` continues, `next(otherKey)` redirects. Forks inherit middlewares live, `fork({ skipResolvers: true })` is now `fork({ middlewares: false })`, and `unuse(middleware)` removes one. `use()` returns the container itself. [Migration](https://masyaka.github.io/injecute/migration/0.x-to-1.0#middleware-signature-key-next-context)
