---
title: Recipes
description: Request scopes, configuration-driven implementations, feature modules, sharing services between containers.
---

# Recipes

## A container per request

<<< @/../examples/recipes/request-scope.ts#request-scope

[Open in the playground](../playground?example=recipes/request-scope)

The same shape works in any framework: create the fork in the handler (or a framework middleware),
add the request, and resolve the handler's services from the fork.

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

preload(app); // resolves every service now, so configuration errors surface at boot
```

`buildServicesGraph(app)` returns every service with its dependencies, for tooling and diagrams; the
[playground](../playground.md) uses it.
