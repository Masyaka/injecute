---
title: Recipes
description: A unit of work per operation, a fork per request, configuration-driven implementations, feature modules, sharing services between containers.
---

# Recipes

## A unit of work per operation

A service creates what one operation owns with a factory, and `using` releases it:

<<< @/../examples/recipes/unit-of-work.ts#unit-of-work

[Open in the playground](../playground?example=recipes/unit-of-work)

More patterns for state that belongs to one request, and a table for choosing between them, are in
[Per-request state](./request-state.md).

## A fork per request

When several per-request services share instances and depend on the app's services, a fork wires them
and disposes them together:

<<< @/../examples/recipes/request-scope.ts#request-scope

[Open in the playground](../playground?example=recipes/request-scope)

Fork the root in one place (the handler or a framework hook) and dispose the fork at the end. Try the
[alternatives](./request-state.md) first: forks per request make the container structure harder to
follow.

## Choosing implementations from configuration

<<< @/../examples/recipes/config-aliases.ts#config-aliases

## Feature modules

Give each feature a module and compose them at the root:

```ts
const app = new DIContainer()
  .addInstance('config', loadConfig())
  .extend(addDatabase) // (c: ServiceRegistry<{ config: Config }>) => …
  .extend(addUsers) // (c: ServiceRegistry<{ db: Database }>) => …
  .extend(addBilling);
```

When a module expects a service under another key or in another shape, see
[Adapting a module's dependencies](./containers.md#adapting-a-module-s-dependencies).

## Sharing services between independent containers

```ts
import { addNamedResolvers, createNamedResolvers, DIContainer } from 'injecute';

const shared = createNamedResolvers(core, ['db', 'logger']);
const feature = new DIContainer().extend(addNamedResolvers(shared));
feature.get('db'); // resolved by `core`
```

## Exposing a container as a plain object

```ts
import { createProxyAccessor } from 'injecute';

const services = createProxyAccessor(app, {
  keys: ['users', ['mailer', 'email']],
});
services.users; // resolves 'users'
services.email; // resolves 'mailer'
```

## Checking the wiring at startup

```ts
import { preload } from 'injecute';

await preload(app); // resolves every service now, so configuration errors surface at boot
```

To run modules' startup work (routes, subscriptions, consumers) and stop it gracefully, see
[Startup and shutdown](./startup-shutdown.md).

`buildServicesGraph(app)` returns every service with its dependencies, for tooling and diagrams; the
[playground](../playground.md) uses it.
