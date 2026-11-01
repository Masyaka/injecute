---
'injecute': minor
---

**`dispose()` and `await using`.** `await container.dispose()` (also `[Symbol.asyncDispose]`, so `await using scope = app.fork()` works) releases every instance the container owns, dependents first. Singletons are disposed with `[Symbol.asyncDispose]` / `[Symbol.dispose]` when they have one, or with a `dispose` function in their registration options (`dispose: false` opts out). `addInstance` values are disposed only with `{ dispose: true | fn }`. Namespace containers are disposed with their parent; forks dispose what they own. Afterwards the container throws on use, and a `dispose` event is emitted.
