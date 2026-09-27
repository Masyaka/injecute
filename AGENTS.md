# AGENTS.md

Guidance for people and coding agents working **on** injecute. For using injecute in an app, read the docs (`docs/`) instead.

## What this is

injecute is a small, dependency-free, type-safe dependency injection container for TypeScript. Dependencies are declared explicitly as keys (no decorators, no reflection). The public API is a fluent chain whose types grow with every registration.

## Commands

| Task | Command |
|---|---|
| Install | `npm ci` |
| Unit tests | `npm test` (watch: `npx vitest`) |
| Build | `npm run build` |

## Layout

| Path | Contents |
|---|---|
| `src/index.ts` | Public entry point. Everything exported here is public API |
| `src/container.ts` | `DIContainer`: registration, resolution, forks, namespaces, middlewares, events |
| `src/types.ts` | Public types and type-level helpers |
| `src/utils/` | Optional helpers (`construct`, `defer`, `preload`, proxy accessor, resolvers, graph) |
| `src/async-container.ts` | Experimental async container. **Not exported** until its design is finished |
| `tests/` | Vitest tests |
| `docs/` | Documentation site and playground |

## Conventions

- TypeScript strict mode. No runtime dependencies.
- Keep the public API small: one recommended way to do each task.
- Every public export has TSDoc with an `@example`.
- Every behaviour change has a test; every type change has a type test.
- Don't edit generated output (`lib/`, `docs/dist/`).
