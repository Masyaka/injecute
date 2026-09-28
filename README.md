# injecute

Type-safe dependency injection for TypeScript, without decorators.

[![Tests](https://github.com/Masyaka/injecute/actions/workflows/tests.yml/badge.svg)](https://github.com/Masyaka/injecute/actions/workflows/tests.yml)
[![npm](https://img.shields.io/npm/v/injecute)](https://www.npmjs.com/package/injecute)
[![JSR](https://jsr.io/badges/@masyaka/injecute)](https://jsr.io/@masyaka/injecute)

- **Explicit, typed wiring.** Register each service with its dependency keys; the container type grows
  with every registration, so `get()` and factory parameters are inferred, and a typo in a key is a
  compile error ("Did you mean …?").
- **No decorators, no reflection.** Your classes and functions stay free of container code.
- **Scopes that behave.** `fork()` for request scopes, `fork({ isolated: true })` for tests.
- **Owns what it creates.** `dispose()` and `await using` release singletons in reverse creation order.
- **Errors that say how to fix it**, with stable codes and a docs page each.
- **Runs everywhere.** ES module for Node.js ≥ 22, Deno, Bun and browsers. No runtime dependencies.

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

Upgrading from 0.x? Read the [migration guide](https://masyaka.github.io/injecute/migration/0.x-to-1.0).

## Using injecute with AI coding agents

The package ships its documentation as Markdown (`node_modules/injecute/llms.txt` and `lib/docs/`) and
two Agent Skills (`skills/`). Add this to your project's `AGENTS.md` (or `CLAUDE.md`) so agents read the
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

## License

MIT
