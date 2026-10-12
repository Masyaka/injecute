---
layout: home
hero:
  name: injecute
  text: Type-safe dependency injection
  tagline: Bring it into a legacy app, or build a new system without a framework's opinions. Plain classes, typed wiring, no decorators required, not invasive. It is easier than you think
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Is it for me?
      link: '#is-it-the-right-choice'
    - theme: alt
      text: Playground
      link: /playground
features:
  - title: Adopt it one module at a time
    details: No big-bang migration needed. Your classes stay as they are; wire one module, ship it, then the next. Works in plain JavaScript too.
  - title: No framework opinions
    details: It wires your services and stops there. HTTP, routing, the database layer and your folder structure stay your choice.
  - title: Non-invasive
    details: Keep your sources free of the framework. Only module files import from injecute, and only its types.
  - title: Wiring mistakes fail at compile time
    details: 'The container''s type grows with every registration. A missing service or a typo in a key is a compile error, with "Did you mean".'
  - title: Tests without mocking libraries
    details: Replace any dependency for the whole graph in an isolated fork. The app container stays untouched.
  - title: Built for coding agents
    details: The docs and an Agent Skill ship in the package, matching your installed version. Agents read explicit wiring and fix errors from their codes.
---

## Where it fits

### A new module inside a big brownfield system

Mature frameworks come with opinions about modules, HTTP, configuration and lifecycle. injecute brings a
container and nothing else, so a new module gets exactly the structure it needs and still plugs into the
system around it.

### A non-typical greenfield project

When a new project doesn't fit a framework's template, injecute gives you a set of tools and the
flexibility to solve the problems you meet as the architecture grows: [forks and modules](./guide/containers.md),
[tags](./guide/tags.md), [lifecycle hooks](./guide/startup-shutdown.md) and
[your own way to register services](./guide/custom-registration.md).

### Code written with coding agents

injecute gives an agent what it needs to get the wiring right without guessing:

- **The docs of your version, in the package.** `llms.txt`, every guide as Markdown and TSDoc with an
  example on every export live in `node_modules/injecute`, so they never drift from the code. An
  [Agent Skill](./guide/ai-agents.md#agent-skill) has the rules for writing, reviewing and debugging it.
- **Wiring an agent can read.** Each registration lists the keys it depends on. There are no decorators,
  naming conventions or reflection to infer, so the agent reads what will be injected.
- **Mistakes caught in the agent's own loop.** A wrong key or a missing service fails the typecheck, with
  "Did you mean". At runtime every error has a stable code, the resolution path and a page that says how
  to fix it.
- **One way per task.** Each task has one recommended way, and the docs lead with it, so generated code
  looks the same across the codebase.
- **Short feedback loop.** The typecheck shows errors early, before any test runs.

See [Using injecute with AI agents](./guide/ai-agents.md) to set it up.

## Is it the right choice?

| Your situation                                                | Choice                                                                                                                       |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| A large app that can't stop for a rewrite                     | **injecute**: adopt it module by module                                                                                      |
| A new service or module that will grow                        | **injecute**: explicit, typed wiring from day one                                                                            |
| A modular monolith                                            | **injecute**: typed [modules](./guide/containers.md#modules) with [private services](./guide/containers.md#private-services) |
| An SDK that other teams install                               | **injecute** inside, consumers get a plain object ([how](./guide/sdk.md))                                                    |
| Much of the code is written by coding agents                  | **injecute**: docs and a skill in the package, errors agents can fix                                                         |
| You want one framework to decide HTTP, validation and modules | A full framework such as NestJS                                                                                              |
| A small script or a typical single-page app                   | No container: imports are enough ([why](./frameworks/ui-frameworks.md))                                                      |
| You need just a CRUD API                                      | A framework with CRUD built in                                                                                               |

## A quick look

```ts
import {
  DIContainer,
  startable,
  startLifecycle,
  type ServiceRegistry,
} from 'injecute';

// a module asks only for what it needs and registers its part of the app
const addUsers = (c: ServiceRegistry<{ db: Database }>) =>
  c.addSingleton('users', UserRepository, ['db']);

const app = new DIContainer()
  .addInstance('dbUrl', 'postgres://localhost/app')
  .addSingleton('db', Database, ['dbUrl'])
  .extend(addUsers)
  .extend(
    startable('server', HttpServer, ['users'], {
      start: (server) => server.listen(3000),
      stop: (server) => server.close(),
    }),
  );

app.get('users'); // UserRepository, typed

// start the server; on shutdown, close it, then dispose the container
const running = await startLifecycle(app);
process.once('SIGTERM', () => running.stop());

// in a test: replace the database for the whole graph, without touching `app`
await using test = app
  .fork({ isolated: true })
  .addInstance('db', fakeDb, { replace: true });
```

No decorators are needed, but if you want them, a
[recipe](./guide/custom-registration.md#services-from-decorators) builds them on top of the container.

Starts and stops servers and consumers in stages, and closes every connection with one call. Works with
[Express, Fastify, Hono, Next.js and GraphQL](./frameworks/index.md), on Node.js, Deno, Bun and in
browsers, with no runtime dependencies.
