---
'injecute': minor
---

**Faster type-checking.** Nothing changes in how you write registrations.

- Code inside `namespace()` and inline `extend()` callbacks typechecks up to about 3× faster: a callback's registry keeps the container's services as one fixed type and grows only its own additions, so lookups into the container are computed once per callback.
- Each `namespace()` call no longer gets slower with the number of namespaces before it.
- Long `addSingleton` chains need about a third fewer type instantiations.
- What a module (`extend()`) or namespace adds becomes one object in the service map instead of one entry per registration: registrations and forks after the modules typecheck about 25–45% faster, and hovers and declaration files show one object per module.

A `namespace()` or `extend()` callback must return the registry it received, as the types always intended; returning another container is now a type error. `ServiceRegistry<S, A>` now keeps the given services (`S`) apart from its own additions (`A`), which shows up in inferred module types; a `DIContainer<S>` is a `ServiceRegistry<{}, S>`. See [Container roles](https://masyaka.github.io/injecute/migration/0.x-to-1.0#container-roles-serviceprovider-serviceregistry-dicontainer).

**Exported containers.** The TypeScript guide now shows naming the service map with `interface AppServices extends ContainerServices<typeof built> {}` for packages that export a container: declaration files get about half the size. See [TypeScript](https://masyaka.github.io/injecute/guide/typescript#exporting-a-container-from-a-package).
