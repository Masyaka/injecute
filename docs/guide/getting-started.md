---
title: Getting started
description: Install injecute, register services with explicit dependency keys, and resolve them with full types.
---

# Getting started

injecute is a dependency injection container for TypeScript without decorators. You register each
service with a **key**, a **factory** (a function or a class) and the **keys it depends on**. The
container resolves everything in the right order, and its type grows with every registration.

## Install

::: code-group

```sh [npm]
npm install injecute
```

```sh [pnpm]
pnpm add injecute
```

```sh [bun]
bun add injecute
```

```sh [deno]
deno add jsr:@masyaka/injecute
```

:::

injecute is an ES module for Node.js ≥ 22, Deno, Bun and browsers, with no runtime dependencies. It also
works [without a build step](./no-build.md).

## Your first container

<<< @/../examples/getting-started.ts#example

[Open in the playground](../playground?example=getting-started)

What happened:

- `addInstance('dbUrl', …)` registers an existing value.
- `addSingleton('db', Database, ['dbUrl'])` registers a class. The container calls `new Database(dbUrl)`
  the first time `db` is needed, then reuses that instance.
- `app.get('users')` resolves `users` and everything it depends on. Its type is `UserRepository`,
  inferred from the registration.

Factory parameters and results are inferred from the registrations:

```ts twoslash
import { DIContainer } from 'injecute';

const app = new DIContainer()
  .addInstance('port', 8080)
  // port: number
  .addSingleton('address', (port) => `http://localhost:${port}`, ['port']);

const address = app.get('address'); // string
//    ^?
```

Mistakes are compile errors. A typo in a dependency key is reported on the key:

```ts
app.addSingleton('server', createServer, ['adress']);
// Type '"adress"' is not assignable to type 'Dependency<…>'. Did you mean '"address"'?
```

## Next steps

- [Registering services](./registration.md): lifetimes, optional dependencies, aliases, decoration.
- [Containers, forks and modules](./containers.md): request scopes, isolated forks for tests, modules.
- [Lifecycle and dispose](./lifecycle.md): releasing connections with `dispose()` and `await using`.
- [Roles](../concepts/roles.md): which part of your code gets which view of the container.
