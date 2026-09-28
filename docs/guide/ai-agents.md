---
title: Using injecute with AI agents
description: Point coding agents at the docs of the installed version, install the Agent Skills, and use llms.txt or Context7.
---

# Using injecute with AI agents

Coding agents write better injecute code when the docs of the version you use are in their context.
injecute ships them in the package, so they always match the installed version.

## Docs in the package

Every release contains:

| Path in `node_modules/injecute/` | Contents                                                               |
| -------------------------------- | ---------------------------------------------------------------------- |
| `llms.txt`                       | An index of the docs below, with a summary of the API rules            |
| `lib/docs/`                      | The guides, concepts, error codes and the migration guide, as Markdown |
| `lib/index.d.ts`                 | The type declarations, with TSDoc and an example on every export       |
| `src/`                           | The TypeScript sources (declaration maps point here)                   |
| `skills/`                        | The Agent Skills below                                                 |
| `CHANGELOG.md`                   | Changes per version                                                    |

Tell your agent to read them. Add this to your project's `AGENTS.md` (or `CLAUDE.md`):

```md
## injecute

Before writing code that uses injecute, read `node_modules/injecute/llms.txt` and the pages it links
(start with `lib/docs/guide/getting-started.md`). Register classes directly, pass dependency keys as the
third argument, type modules as `ServiceRegistry<{ …what they need }>`, use `fork({ isolated: true })`
in tests, and branch on `InjecuteError.code`.
```

An index that is always in context works better than docs the agent has to decide to look up.

## Agent Skills

Two [Agent Skills](https://agentskills.io) come with the package and the repository:

- **`injecute`**: the rules for writing, reviewing and debugging injecute code.
- **`injecute-migrate-to-v1`**: a step-by-step migration of a codebase from 0.x, with search patterns.

Install them in Claude Code from the plugin marketplace in the repository:

```sh
/plugin marketplace add Masyaka/injecute
/plugin install injecute@injecute
```

Or, for any agent that supports skills:

```sh
npx skills add Masyaka/injecute
```

## Online

- [`llms.txt`](https://masyaka.github.io/injecute/llms.txt) indexes the website;
  [`llms-full.txt`](https://masyaka.github.io/injecute/llms-full.txt) is every page in one file.
- Every page is also available as Markdown: add `.md` to its URL, or use the links at the top of the
  page.
- [Context7](https://context7.com/masyaka/injecute) serves these docs to agents that use it.

The online docs describe the latest version. For the version you have installed, prefer the docs in
the package.
