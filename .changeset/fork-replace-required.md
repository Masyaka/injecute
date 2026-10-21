---
'injecute': major
---

**A fork needs `replace: true` to override a parent's key.** Registering a key that a parent container has now throws `INJECUTE_ALREADY_REGISTERED` unless `{ replace: true }` is passed, in plain forks, isolated forks, modules applied to a fork and `namespace()` callbacks. Before, the fork registered it silently, and services registered in the parent kept the parent's instance without anything saying so. The error now says what the override reaches: in a plain fork it names the parent services that depend on the key (directly or through other services) and keep the parent's instance, and how to give them the fork's one. `addAlias()` takes `{ replace: true }` too.

Before → after: `app.fork().addInstance('logger', requestLogger)` → `app.fork().addInstance('logger', requestLogger, { replace: true })`. Decorating a parent's service in a fork needs it as well. See [A fork needs `replace: true` to override a parent's key](https://masyaka.github.io/injecute/migration/0.x-to-1.0#a-fork-needs-replace-true-to-override-a-parent-s-key).
