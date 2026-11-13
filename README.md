# injecute

Type-safe dependency injection for TypeScript and JavaScript: explicit wiring, plain classes, no
decorators. Adopt it one module at a time in an existing app, or structure a new one without a
framework's opinions.

[![Tests](https://github.com/Masyaka/injecute/actions/workflows/tests.yml/badge.svg)](https://github.com/Masyaka/injecute/actions/workflows/tests.yml)
[![npm](https://img.shields.io/npm/v/injecute)](https://www.npmjs.com/package/injecute)
[![JSR](https://jsr.io/badges/@masyaka/injecute)](https://jsr.io/@masyaka/injecute)

## Features

- **Typed from the registrations.** `get()` results and factory parameters are inferred; a missing
  service or a wrong dependency key fails the typecheck. See [TypeScript](https://masyaka.github.io/injecute/guide/typescript).
- **Explicit wiring, plain classes.** Dependencies are keys listed next to the factory. Your code has no
  decorators, no reflection and no container imports ([why](https://masyaka.github.io/injecute/concepts/principles#_1-explicit-wiring)).
- **Modules and private services.** Each module declares the services it needs, and the compiler checks
  that the app provides them. See [Modules](https://masyaka.github.io/injecute/guide/containers#modules).
- **Extension points.** Modules contribute routes, handlers or plugins through
  [tags](https://masyaka.github.io/injecute/guide/tags), without importing each other.
- **Scopes.** A fork per request, transaction or job, with its own services; the root can't depend on a
  scope, and the compiler checks it. See [Scopes](https://masyaka.github.io/injecute/guide/request-state#scopes).
- **Start, stop, dispose.** Starts servers and consumers in [stages](https://masyaka.github.io/injecute/guide/startup-shutdown),
  stops them in reverse, then releases every singleton.
- **Tests without mocking libraries.** An [isolated fork](https://masyaka.github.io/injecute/guide/testing)
  replaces a dependency for the whole graph.
- **Errors that say how to fix them.** Stable codes, the resolution path and a
  [page](https://masyaka.github.io/injecute/errors/) for each.
- **Runs everywhere.** ES module for Node.js ≥ 22.12, Deno, Bun and browsers, with no runtime
  dependencies. Semantic versioning covers the types too ([versioning](https://masyaka.github.io/injecute/guide/versioning)).

## Example

```ts
import {
  collect,
  createTag,
  DIContainer,
  startable,
  startLifecycle,
  type ServiceRegistry,
} from 'injecute';

// Your classes stay plain (no decorators, no container imports):
// Database(url) · UserRepository(db) · HttpServer(routes: Route[])

// ① An extension point: modules add routes without importing the server
const route = createTag('route').of<Route>();

// ② A module asks only for what it needs
const addUsers = (c: ServiceRegistry<{ db: Database }>) =>
  c
    .addSingleton('repo', UserRepository, ['db'])
    .addSingleton(
      route('list'),
      (repo): Route => ({ path: '/users', handle: () => repo.findAll() }),
      ['repo'],
    );

// ③ The composition root: every dependency is a key you review in a diff
const app = new DIContainer()
  .addInstance('dbUrl', 'postgres://localhost/app')
  .addSingleton('db', Database, ['dbUrl']) // ['dbUlr'] → compile error: Did you mean '"dbUrl"'?
  .namespace('Users', addUsers) // fails to compile if the app has no `db`
  .extend(
    startable('server', HttpServer, [collect(route)], {
      start: (server) => server.listen(3000),
      stop: (server) => server.close(),
    }),
  )
  .seal();

app.get('Users.repo'); // ④ UserRepository, inferred

// ⑤ A scope per request: its own transaction, on top of the app's services
async function handle() {
  await using scope = app.fork().addSingleton('tx', (db) => db.begin(), ['db']);
  scope.get('tx').commit(); // rolled back on dispose unless committed
}

// ⑥ Start the server; on SIGTERM stop it, then close the database
const running = await startLifecycle(app);
process.once('SIGTERM', () => running.stop());

// ⑦ In tests: replace the database for the whole graph, without touching `app`
await using test = app
  .fork({ isolated: true })
  .addInstance('db', fakeDb, { replace: true });
```

The full version with the classes is [`examples/readme.ts`](./examples/readme.ts); run it in the
[playground](https://masyaka.github.io/injecute/playground?example=readme).

## Install

```sh
npm install injecute          # or: pnpm add injecute · bun add injecute
deno add npm:injecute
```

Or without a build step: `import { DIContainer } from 'https://esm.sh/injecute@1'`.

## Is it for me?

| Your situation                                                | Choice                                                                                                                                                                                   |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A large app that can't stop for a rewrite                     | **injecute**: adopt it module by module                                                                                                                                                  |
| A new service or module that will grow                        | **injecute**: explicit, typed wiring from day one                                                                                                                                        |
| A modular monolith                                            | **injecute**: typed [modules](https://masyaka.github.io/injecute/guide/containers#modules) with [private services](https://masyaka.github.io/injecute/guide/containers#private-services) |
| An SDK that other teams install                               | **injecute** inside, consumers get a plain object ([how](https://masyaka.github.io/injecute/guide/sdk))                                                                                  |
| Much of the code is written by coding agents                  | **injecute**: docs and a skill in the package, errors agents can fix ([below](#using-injecute-with-ai-coding-agents))                                                                    |
| You want one framework to decide HTTP, validation and modules | A full framework such as NestJS                                                                                                                                                          |
| A small script or a typical single-page app                   | No container: imports are enough ([why](https://masyaka.github.io/injecute/frameworks/ui-frameworks))                                                                                    |
| You need just a CRUD API                                      | A framework with CRUD built in                                                                                                                                                           |

The [design principles](https://masyaka.github.io/injecute/concepts/principles) explain how injecute
behaves and why, and the [comparison](https://masyaka.github.io/injecute/concepts/comparison) shows how it
differs from typed-inject, needle-di, Awilix, InversifyJS, tsyringe, NestJS and Effect.

## Documentation

**[masyaka.github.io/injecute](https://masyaka.github.io/injecute/)**: guides, recipes, API reference,
error codes and a [playground](https://masyaka.github.io/injecute/playground).

Using a framework? See [Express, Fastify, Hono, Next.js and GraphQL](https://masyaka.github.io/injecute/frameworks/),
[React, Vue and Solid](https://masyaka.github.io/injecute/frameworks/ui-frameworks),
or [Coming from NestJS](https://masyaka.github.io/injecute/frameworks/nestjs).

Upgrading from 0.x? Read the [migration guide](https://masyaka.github.io/injecute/migration/0.x-to-1.0).

## Using injecute with AI coding agents

The package ships its documentation as Markdown (`node_modules/injecute/llms.txt` and `lib/docs/`) and
an Agent Skill (`skills/injecute`). Add this to your project's `AGENTS.md` (or `CLAUDE.md`) so agents read the
docs of the version you have installed:

```md
## injecute

Before writing code that uses injecute, read `node_modules/injecute/llms.txt` and the pages it links
(start with `lib/docs/guide/getting-started.md`). Register classes directly, pass dependency keys as the
third argument, type modules as `ServiceRegistry<{ …what they need }>`, use `fork({ isolated: true })`
in tests, and branch on `InjecuteError.code`.
```

Claude Code: `/plugin marketplace add Masyaka/injecute`, then `/plugin install injecute@injecute`. Other
agents: `npx skills add Masyaka/injecute`. More in
[Using injecute with AI agents](https://masyaka.github.io/injecute/guide/ai-agents).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Security issues: [SECURITY.md](./SECURITY.md). Versioning and
supported TypeScript versions: [Versioning and support](https://masyaka.github.io/injecute/guide/versioning).

## License

MIT
