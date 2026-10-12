# injecute

Type-safe dependency injection for TypeScript and JavaScript.

[![Tests](https://github.com/Masyaka/injecute/actions/workflows/tests.yml/badge.svg)](https://github.com/Masyaka/injecute/actions/workflows/tests.yml)
[![npm](https://img.shields.io/npm/v/injecute)](https://www.npmjs.com/package/injecute)
[![JSR](https://jsr.io/badges/@masyaka/injecute)](https://jsr.io/@masyaka/injecute)

## Where it fits

- **A large app you can't stop to rewrite.** Start with small local changes where you need them. It doesn't require changes to your pipelines or tech stack.
- **A new module inside a big system.** It brings a container and nothing else: no opinions about
  HTTP, modules or configuration, so the module gets the structure it needs.
- **A modular monolith.** Each module declares the services it needs and the compiler checks them,
  keeps its helpers [private](https://masyaka.github.io/injecute/guide/containers#private-services),
  and contributes to other modules through [extension points](https://masyaka.github.io/injecute/guide/tags)
  without importing them.
- **An SDK that other teams install.** The SDK wires its services in a container of its own and gives
  consumers a plain object with lazy services, start and stop, plugins and a test kit. See
  [Building an SDK](https://masyaka.github.io/injecute/guide/sdk).
- **A non-typical greenfield project.** Gives you a set of tools and flexibility to solve problems you can encounter in your architecture journey.
- **Code written with coding agents.** The docs of the installed version and an Agent Skill ship in the
  package (see [below](#using-injecute-with-ai-coding-agents)). The wiring is explicit, mistakes fail
  the typecheck with a short feedback loop, and every runtime error has a stable code and a page that says how to fix it.

## Where it is not the best option

- For a small script or a typical single-page app, you don't need a container.
- If you want one framework to decide HTTP, validation and modules for you, a full framework such as NestJS fits better.
- If you need just a CRUD API.

## Features

- **Explicit, typed wiring.** Register each service with its dependency keys; the container type grows
  with every registration, so `get()` and factory parameters are inferred, and a typo in a key is a
  compile error ("Did you mean …?").
- **No decorators, no reflection.** Your classes and functions stay free of container code. But there is a [recipe](https://masyaka.github.io/injecute/guide/custom-registration#services-from-decorators) if you really want decorators for some reason.
- **Scopes that behave.** `fork()` for child containers, `fork({ isolated: true })` for tests.
- **Owns what it creates.** `dispose()` and `await using` release singletons in reverse creation order.
- **Errors that say how to fix it**, with stable codes and a docs page each.
- **Runs everywhere.** ES module for Node.js ≥ 22, Deno, Bun and browsers. No runtime dependencies.

The [design principles](https://masyaka.github.io/injecute/concepts/principles) explain how injecute
behaves and why.

## Install

```sh
npm install injecute          # or: pnpm add injecute · bun add injecute
deno add jsr:@masyaka/injecute
```

Or without a build step: `import { DIContainer } from 'https://esm.sh/injecute@1'`.

## Example

```ts
import { DIContainer } from 'injecute';

class Database {
  constructor(readonly url: string) {}
}

class UserRepository {
  constructor(private readonly db: Database) {}
}

const app = new DIContainer()
  .addInstance('dbUrl', 'postgres://localhost/app')
  .addSingleton('db', Database, ['dbUrl'])
  .addSingleton('users', UserRepository, ['db']);

const users = app.get('users'); // UserRepository

// in tests: replace a dependency for the whole graph, without touching `app`
await using test = app
  .fork({ isolated: true })
  .addInstance('db', fakeDb, { replace: true });
```

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
