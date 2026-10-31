---
title: Containers, forks and modules
description: Forks, isolated forks for tests, modules with extend(), and namespaces.
---

# Containers, forks and modules

## Forks

`fork()` creates a child container. The child sees every service of its parent, including ones the
parent registers later. What you add to the child stays in the child.

<<< @/../examples/containers.ts#fork

[Open in the playground](../playground?example=containers)

A service registered in the parent **runs in the parent** and is shared by all forks: the database pool
is created once, and what a fork adds stays in the fork. Parent services can't depend on what a fork
adds.

### Scopes

A fork created for one unit of work, such as a user session, a request, a transaction or a job, is a
**scope**: it registers the services that belong to that unit of work, uses the root's services, and is
disposed when the work is done. The direction is fixed: a scope's services may depend on the root's,
the root's never on a scope's.

- The compiler checks it: a root service can't name a key that only a scope registers.
- A scope that registers a key the root already has needs `replace: true`, and the error says which
  root services keep the root's instance (see below).
- Each feature with scoped services gives them their own module, applied to the scope in one place:
  see [Scoped state](./request-state.md#scopes), which also compares scopes with patterns that keep
  every service in the root.

### Overriding a parent's service in a fork

To register a key its parent has, a fork needs `{ replace: true }`, like a replacement in the same
container. The override reaches only the services resolved in the fork: a service registered in the
parent runs in the parent and keeps the parent's instance. Without `replace: true` the fork throws
`INJECUTE_ALREADY_REGISTERED`, and the message names the parent services that would keep the parent's
one:

<<< @/../examples/containers.ts#fork-override

To give a parent service the fork's instance, register that service in the fork too. To replace a
dependency for every service, use an isolated fork.

### Decorating a root service in a scope

A scope can decorate a root service for its own services, with a dependency on the key itself and
`replace: true`. Here the scope's services log with the request id, and root services keep the root's
logger:

<<< @/../examples/containers.ts#scope-decorate

## Isolated forks

`fork({ isolated: true })` runs **every** service it resolves inside the fork, including services
registered in its parents. Overrides then reach the whole graph, and nothing leaks back into the parent.

<<< @/../examples/containers.ts#isolated

Use isolated forks for tests and for per-tenant variants of an app container. Namespaces are re-created
inside the fork, and forks of an isolated fork share its instances.

## Modules

A module is a plain function that registers services. It receives a
[`ServiceRegistry`](../concepts/roles.md): it can register, but not add middlewares, fork or dispose.
Declare only the services the module needs; `extend()` checks that the container has them.

<<< @/../examples/containers.ts#modules

A module only registers. Work that must run when the app starts (adding routes to another module's
router, subscribing to events, starting a consumer) goes in a
[lifecycle hook](./startup-shutdown.md), not in the module function. To let other modules contribute
to one of yours (routes, commands, health checks), give it an [extension point](./tags.md).

Keep each module in a wiring file of its own, next to the feature it wires. See
[Keep the wiring in files of its own](./app-structure.md#keep-the-wiring-in-files-of-its-own).

If a required service is missing, the error names it:

```text
Argument of type '(c: ServiceRegistry<{ db: Database; }>) => …' is not assignable to parameter of type
'{ 'injecute: extension requires services that are not registered': "db"; }'.
```

## Namespaces

`namespace(name, callback)` groups the services a callback registers under a prefix. The callback
receives a fork of the container, so it can use every service registered there.

<<< @/../examples/containers.ts#namespaces

`get('Reports')` returns a read-only provider of the namespace. In the container's service map
(`ContainerServices<typeof app>`), `Reports` is a `Namespace` marker next to the `Reports.*` keys;
`NamespaceServices<typeof app, 'Reports'>` gives the namespace's services.

## Private services

A module often has services that only its own services use: a cache, a client, a retry policy. Register
them under a symbol key, and apply the module as a namespace. Don't export the symbol:

<<< @/../examples/containers.ts#private

- **What makes them private.** A namespace adds its string and number keys to the container as
  `Name.key`, but not its symbol keys. Inside the namespace, services depend on the symbol like on any
  key. Outside it, `get()` with the symbol is a compile error and fails with
  [`INJECUTE_NOT_REGISTERED`](../errors/not-registered.md), and `keys` doesn't list it.
- **Tests still reach them.** Replace a dependency of the module in an
  [isolated fork](#isolated-forks), and its private services use the replacement too. To replace a
  private service itself, the test needs the symbol: replace the public dependencies instead, or export
  the symbol from a file only tests import.
- **Only with `namespace()`.** With `extend()`, a symbol key is registered in the container itself.
  Then only the unexported symbol keeps others out, and `keys` lists it.
- **Not a security boundary.** `get('Catalog')` returns a provider of the namespace for inspection,
  and its `keys` include the symbols. Code that enumerates them can resolve them, as code can read
  symbol properties of an object with `Object.getOwnPropertySymbols()`.

A naming convention such as `_cache` doesn't do this: keys are names
([principle 8](../concepts/principles.md#_8-keys-are-names)), so `Catalog._cache` is linked and resolved
like any other key.

## Adapting a module's dependencies

A module names the services it needs under its own keys. When the container has them under other
keys, or in another shape, register the missing keys before `extend()`: `addAlias()` for the same
service under another key, a factory for a value derived from another service. Do it in a namespace,
so the adapters stay out of the container's root:

<<< @/../examples/containers.ts#adapt

- The adapters are services of the namespace like any other: `host.get('Audit.dbUrl')` resolves them,
  and `fork({ isolated: true })` overrides of `config` reach them.
- An adapter has a lifetime too. A singleton keeps the first value it derives; register it with
  `addTransient()` when the value must follow a service that changes.
- `extend()` on the container itself works without a namespace, but the adapters then become keys of
  the root, and two modules that need `dbUrl` with different values can't both have it.

## Sealing the composition root

`seal()` ends the registrations of a container: afterwards `add*`, `namespace()` and `extend()` throw
`INJECUTE_SEALED`, and its type has no registration methods. Resolving, middlewares, events, `reset()`
and `dispose()` keep working, and forks are open, so request scopes and tests fork the sealed root.

<<< @/../examples/containers.ts#seal

A sealed container's type is also cheaper for TypeScript: its service map is one object instead of an
intersection of every registration, so forks and request scopes built on it typecheck faster and show
readable types (see [TypeScript](./typescript.md#seal-the-composition-root)).

## Which one to use

| You want to…                                                       | Use                                                          |
| ------------------------------------------------------------------ | ------------------------------------------------------------ |
| give services the trace id, tenant or user of the current request  | a [context accessor](./request-context.md)                   |
| register services for one session, request, transaction or job     | a [scope](#scopes): a fork with a scope module               |
| choose between a scope and patterns that keep services in the root | [Scoped state](./request-state.md)                           |
| replace a dependency for everything, without touching the original | `fork({ isolated: true })`                                   |
| split registrations by feature                                     | modules with `extend()`                                      |
| group services under a name, e.g. `Billing.*`                      | `namespace()`                                                |
| keep a module's helper services out of reach of other modules      | [symbol keys in a namespace](#private-services)              |
| apply a module that names its dependencies differently             | [adapters in a namespace](#adapting-a-module-s-dependencies) |
