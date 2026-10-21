---
'injecute': major
---

**`replace: true` needs something to replace.** Registering a key with `{ replace: true }` when neither the container nor a parent has that key now throws the new `INJECUTE_NOTHING_TO_REPLACE` error. Before, it quietly registered a new service, so a typo in a test override, or a module that wasn't applied, left the original in place without anything saying so. This applies to `addSingleton`, `addTransient`, `addInstance` and `addAlias`, in every kind of container, module and namespace.

Before → after: `new DIContainer().addInstance('config', cfg, { replace: true })` (first registration) → `new DIContainer().addInstance('config', cfg)`. See [A fork needs `replace: true` to override a parent's key](https://masyaka.github.io/injecute/migration/0.x-to-1.0#a-fork-needs-replace-true-to-override-a-parent-s-key).
