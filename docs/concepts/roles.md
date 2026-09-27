---
title: 'Roles: provider, registry, container'
description: Why injecute gives consumers a ServiceProvider, modules a ServiceRegistry, and only the composition root the DIContainer.
---

# Roles: provider, registry, container

A container is used in three different ways, and each place in your code should get only the part it
needs.

| Type                 | Can                                                                                                                                             | Give it to                                              |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `ServiceProvider<S>` | resolve (`get`, `has`, `createResolver`, `call`) and inspect (`keys`, `ownKeys`, `getParent`, `getRegistration`)                                | handlers and other code that consumes services, tooling |
| `ServiceRegistry<S>` | everything a provider can, plus register (`addSingleton`, `addTransient`, `addInstance`, `addAlias`, `namespace`, `extend`, `injecute`, `bind`) | module functions and `namespace()` callbacks            |
| `DIContainer<S>`     | everything, plus configure (`use`, `unuse`, events) and own the lifecycle (`fork`, `reset`, `dispose`)                                          | the composition root: the code that builds the app      |

Each type is a subset of the next, so a `DIContainer` can be passed wherever a registry or a provider is
expected.

## Why

- **Consumers cannot rewire the app.** A handler that only needs `users` gets a
  `ServiceProvider<{ users: UserRepository }>`; it cannot register or replace services by accident.
- **Modules cannot take over configuration.** A module registers its services, but adding middlewares,
  listening to events, forking or disposing stays with the composition root.
- **Resolution-time code is read-only.** Middlewares and event listeners receive the container as a
  provider, and so do `getParent()` and namespace providers from `get('Namespace')`.

These are compile-time guarantees; at runtime every view is the same container object.

## Declaring what you need

A provider of more services is assignable to a provider of fewer:

```ts
function listUsers(services: ServiceProvider<{ users: UserRepository }>) {
  return services.get('users').findAll();
}
listUsers(app); // app has `users` and many other services
```

A module declares its requirements the same way and is applied with `extend()`, which checks them:

```ts
const addBilling = (c: ServiceRegistry<{ db: Database }>) =>
  c.addSingleton('invoices', InvoiceRepository, ['db']);

app.extend(addBilling);
```

Call modules through `extend()` (or `namespace()`), not directly: `addBilling(app)` would require the
module's types to match the container exactly.

## Libraries built on injecute

A helper that needs the whole container (for example, to add a middleware) takes a `DIContainer`. Make
`injecute` a **peer dependency** of such a package, so the app and the helper share one copy of the
class.
