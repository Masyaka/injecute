---
'injecute': patch
---

**`replace: true` changes a service's type.** Registering a key again with `replace: true` now gives the service the new type; before, the old and the new type were intersected, so replacing a `string` with a `number` made `get()` return `never`. In a fork, pass `replace: true` when an override changes the type. A module that replaces a service of the container it is applied to still intersects the types. See [Decorating a service](https://masyaka.github.io/injecute/guide/registration#decorating-a-service).
