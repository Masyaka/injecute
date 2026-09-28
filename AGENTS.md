# AGENTS.md

Guidance for people and coding agents working **on** injecute. For using injecute in an app, read the docs (`docs/`) instead.

## What this is

injecute is a small, dependency-free, type-safe dependency injection container for TypeScript. Dependencies are declared explicitly as keys (no decorators, no reflection). The public API is a fluent chain whose types grow with every registration.

## Commands

| Task                  | Command                                                 |
| --------------------- | ------------------------------------------------------- |
| Install               | `npm ci`                                                |
| Everything CI runs    | `npm run check` (format, lint, typecheck, tests, build) |
| Unit + type tests     | `npm test` (watch: `npm run test:watch`)                |
| Typecheck src + tests | `npm run typecheck`                                     |
| Lint / format         | `npm run lint` / `npm run format`                       |
| Build                 | `npm run build`                                         |
| Add a changeset       | `npx changeset` (docs/CI-only: `npx changeset --empty`) |

## Layout

| Path                     | Contents                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------ |
| `src/index.ts`           | Public entry point. Everything exported here is public API                           |
| `src/container.ts`       | `DIContainer`: registration, resolution, forks, namespaces, middlewares, events      |
| `src/types.ts`           | Public types and type-level helpers                                                  |
| `src/utils/`             | Optional helpers (`construct`, `defer`, `preload`, proxy accessor, resolvers, graph) |
| `src/async-container.ts` | Experimental async container. **Not exported** until its design is finished          |
| `tests/`                 | Vitest tests                                                                         |
| `docs/`                  | Documentation site and playground                                                    |
| `examples/`              | Tested examples, embedded in the docs (`<<< @/../examples/…#region`)                 |
| `skills/`                | Agent Skills for **users** of injecute (published in the package)                    |
| `llms.txt`               | Index of the docs shipped in the package (`lib/docs/`, built by `npm run build`)     |

## Conventions

- TypeScript strict mode. No runtime dependencies.
- Keep the public API small: one recommended way to do each task.
- Every public export has TSDoc with an `@example`.
- Every behaviour change has a test; every type change has a type test.
- Don't edit generated output (`lib/`, `docs/api/`, `docs/errors/*.md`, `docs/.vitepress/dist/`).
- A new docs page goes into the sidebar (`docs/.vitepress/config.ts`) and into `llms.txt`; the build fails if `llms.txt` misses a page.
- Don't put an `AGENTS.md` or `CLAUDE.md` into the published package: agents would load it as instructions in consumers' projects.

## Changesets

Every change to the published package needs a changeset (`npx changeset`). CI fails a pull request without one.

- Write the summary for **users**, not for reviewers: what changed and what to do about it.
- Breaking changes: add a one-line "before → after" and link the section of `docs/migration/0.x-to-1.0.md` that explains it. Add that section in the same pull request.
- Docs, tests and CI-only changes: `npx changeset --empty`.

## Definition of done

1. `npm run check` passes.
2. Behaviour changes have runtime tests; type changes have type tests.
3. A changeset is added (see above); breaking changes are in the migration guide.
4. TSDoc is updated for every touched export.
