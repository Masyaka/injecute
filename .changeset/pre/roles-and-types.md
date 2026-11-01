---
'injecute': major
---

**Container roles and a new type layer.** `ServiceProvider<S>` (resolve + inspect) ⊂ `ServiceRegistry<S>` (+ register) ⊂ `DIContainer<S>` (+ middlewares, events, fork, reset, dispose). The chain keeps its type, so `.use()` works after `.add*()`; modules can be plain functions over `ServiceRegistry<{ …what they need }>` and `extend()` reports missing services by name; namespace providers, `getParent()` and middleware/event containers are read-only. `IDIContainer` is a deprecated alias of `ServiceRegistry`. [Migration](https://masyaka.github.io/injecute/migration/0.x-to-1.0#container-roles-serviceprovider-serviceregistry-dicontainer)

**Classes are registered directly** (`addSingleton('users', UserRepository, ['db'])`); `construct()` stays for ES5-compiled and bound classes. **`optional(key)`** replaces the `'undefined'` dependency key.

**Better type errors:** a typo in a dependency key is reported on the key with "Did you mean", and errors show flat service maps instead of nested helper types.

**Renamed:** `get(key, { allowUnresolved })` → `{ optional }`, `has(key, false)` → `has(key, { local: true })`, `new DIContainer({ parentContainer })` → `parent.fork()`, `ArgumentsKey` → `ServiceKey`, `DependenciesToTypes` → `ResolveDependencies`. The default export and unused helper types are removed. [Migration](https://masyaka.github.io/injecute/migration/0.x-to-1.0#renamed-options-and-removed-constructor-argument)
