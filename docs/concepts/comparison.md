---
title: Comparison
description: How injecute compares with typed-inject, needle-di, Awilix, InversifyJS, tsyringe, NestJS and Effect, with the sources for every claim.
---

# Comparison

How injecute compares with other ways to do dependency injection in TypeScript. Every claim about another
library links to its docs, README or source in [Sources](#sources), checked against the
versions in the first table. Found something wrong or out of date?
[Tell us in Discussions](https://github.com/Masyaka/injecute/discussions/categories/ideas).

## Wiring

| Library                       | Version | How a service gets its dependencies                                                     | A missing registration is…                                                  | Decorators / reflect-metadata                     |
| ----------------------------- | ------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------- |
| **injecute**                  | 1.0     | Each registration lists its dependency keys: `addSingleton('users', Repo, ['db'])`      | a compile error ("Did you mean …?")                                         | none                                              |
| [typed-inject](#typed-inject) | 5.0.0   | A `static inject = ['db'] as const` array on the class or function                      | a compile error                                                             | none                                              |
| [needle-di](#needle-di)       | 1.2.1   | `inject(Token)` in constructor defaults or fields, or providers bound by hand           | a runtime error (token types are checked)                                   | optional standard decorators, no reflect-metadata |
| [Awilix](#awilix)             | 13.0.5  | By name: a destructured "cradle" object, or parsed parameter names; `loadModules` globs | a runtime error (the container type grows since v13, `asClass` isn't typed) | none                                              |
| [InversifyJS](#inversifyjs)   | 8.2.3   | `@injectable()` / `@inject(id)` and `container.bind(id)`                                | a runtime error (opt-in typed binding map)                                  | required for decorator injection                  |
| [tsyringe](#tsyringe)         | 4.10.0  | `@injectable()` and emitted constructor types; `@inject(token)` for other tokens        | a runtime error                                                             | required                                          |
| [NestJS](#nestjs)             | 12.3.2  | `@Injectable()` providers in modules, resolved by constructor type                      | a runtime error at bootstrap                                                | required                                          |
| [Effect](#effect)             | 4.1.1   | Services (`Context.Service`) used with `yield*`, provided by layers                     | a compile error (unmet requirements stay in the type)                       | none                                              |

## Lifetimes, async and disposal

| Library      | Scoped services                                                          | A singleton that depends on a scoped service                                                                                                                             | Async services                                                                | Disposal                                                                                        |
| ------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **injecute** | [Scopes](../guide/request-state.md#scopes): a fork with its own services | a compile error for a scope-only key; a scope that re-registers a root key must say `replace: true`, and the error names the root services that keep the root's instance | `AsyncDIContainer` awaits every dependency; async singletons in any container | `dispose()` / `await using` (`Symbol.dispose`), [lifecycle hooks](../guide/startup-shutdown.md) |
| typed-inject | Child injectors; Singleton and Transient                                 | not documented                                                                                                                                                           | not documented                                                                | `injector.dispose()` calls `dispose()` methods                                                  |
| needle-di    | Child containers; every provider is a singleton per container            | not documented                                                                                                                                                           | async providers with `getAsync()`                                             | not documented                                                                                  |
| Awilix       | `SCOPED` lifetime with `createScope()`                                   | a runtime error in `strict` mode (opt-in, off by default)                                                                                                                | not built in (a third-party package)                                          | `dispose()` with per-registration disposers                                                     |
| InversifyJS  | Child containers; "Request" means one `get()` call                       | not handled                                                                                                                                                              | `getAsync()`                                                                  | `onDeactivation` / `@preDestroy` on unbind; `Symbol.dispose` through a plugin                   |
| tsyringe     | `ContainerScoped` in child containers                                    | not handled                                                                                                                                                              | none                                                                          | `dispose()` calls `dispose()` methods                                                           |
| NestJS       | `Scope.REQUEST`, durable providers                                       | prevented: a request-scoped dependency makes its consumers request-scoped too                                                                                            | async factory providers                                                       | lifecycle hooks (not called for request-scoped providers)                                       |
| Effect       | No named scope: provide the service or layer per unit of work            | not documented                                                                                                                                                           | layers are built from effects                                                 | scopes and finalizers (`acquireRelease`)                                                        |

## Size

The size of a small app that registers a value and a service that depends on it, resolves the service and
prints it: bundled with esbuild 0.28 for the browser, minified and gzipped, each bundle run to check it
prints the right value.

| Library      | Bundle (gzipped)                                     | Runtime dependencies                                  | Module formats         |
| ------------ | ---------------------------------------------------- | ----------------------------------------------------- | ---------------------- |
| typed-inject | 1.4 kB                                               | none                                                  | ESM                    |
| needle-di    | 2.7 kB                                               | none                                                  | ESM (npm and JSR)      |
| Awilix       | 3.6 kB (browser build, without `loadModules`)        | `fast-glob` (Node.js build)                           | CommonJS, ESM, browser |
| **injecute** | 6.3 kB (error hints are left out in browser bundles) | none                                                  | ESM (npm and JSR)      |
| tsyringe     | 9.2 kB with the reflect-metadata polyfill it needs   | `tslib`, plus a Reflect polyfill                      | CommonJS, ES5 ESM      |
| InversifyJS  | 22.9 kB                                              | `@inversifyjs/*` packages                             | ESM                    |
| Effect       | 59.7 kB (the Effect runtime)                         | none                                                  | ESM                    |
| NestJS       | not comparable: a server framework                   | 5 small packages; `reflect-metadata`, `rxjs` as peers | ESM                    |

Versions and dependencies are from the npm registry.

## Where injecute is different

- **Explicit scopes that can't leak.** A root service can't name a key that only a scope registers, and a
  scope that re-registers a root key gets an error naming the root services that keep the root's instance.
  Of the libraries above, NestJS prevents the leak by making consumers request-scoped, Awilix detects it
  in strict mode, and the rest don't handle it.
- **A whole-graph check in one test.** [`checkWiring()`](../guide/testing.md#check-the-wiring) reports
  every missing key and every failing factory at once.
- **Errors with codes and pages.** Every error has a stable code, the resolution path, and a
  [page](../errors/index.md) that says how to fix it.
- **Lifecycle and disposal built in.** `dispose()`, `await using`, and
  [startup and shutdown hooks](../guide/startup-shutdown.md) without a framework.
- **Docs for coding agents in the package.** `llms.txt`, the docs of the installed version and an Agent
  Skill ship with it ([AI agents](../guide/ai-agents.md)).

## Sources

### typed-inject

- Version 5.0.0: [CHANGELOG](https://github.com/nicojs/typed-inject/blob/master/CHANGELOG.md).
- `static inject` tokens, no decorators: [Usage](https://github.com/nicojs/typed-inject#usage),
  [Motivation](https://github.com/nicojs/typed-inject#motivation).
- "If your project compiles, you know your dependencies are resolved at runtime":
  [Installation](https://github.com/nicojs/typed-inject#installation).
- Singleton and Transient, child injectors:
  [Lifecycle control](https://github.com/nicojs/typed-inject#lifecycle-control),
  [createChildInjector](https://github.com/nicojs/typed-inject#injectorcreatechildinjector-injectortcontext).
- Disposal: [Disposing provided stuff](https://github.com/nicojs/typed-inject#disposing-provided-stuff).
- ESM only since v4, no dependencies: [CHANGELOG](https://github.com/nicojs/typed-inject/blob/master/CHANGELOG.md).

### needle-di

- Version 1.2.1: [CHANGELOG](https://github.com/needle-di/needle-di/blob/main/CHANGELOG.md).
- `inject()` and binding: [Injection](https://needle-di.io/concepts/injection.html),
  [Binding](https://needle-di.io/concepts/binding.html).
- Missing providers throw at runtime: [Optional injection](https://needle-di.io/advanced/optional-injection.html).
- Standard decorators, optional: [Auto-binding](https://needle-di.io/concepts/binding.html#auto-binding).
- Singletons per container, child containers: [Providers](https://needle-di.io/concepts/providers.html),
  [Child containers](https://needle-di.io/advanced/child-containers.html).
- Async providers: [Async injection](https://needle-di.io/advanced/async-injection.html).
- ESM, npm and JSR: [Getting started](https://needle-di.io/getting-started.html).

### Awilix

- Version 13.0.5: [CHANGELOG](https://github.com/jeffijoe/awilix/blob/master/CHANGELOG.md).
- Injection by name, `PROXY` and `CLASSIC` modes: [Injection modes](https://github.com/jeffijoe/awilix#injection-modes).
- Typing: [`resolve` overloads](https://github.com/jeffijoe/awilix/blob/master/src/container.ts),
  [`asClass`](https://github.com/jeffijoe/awilix/blob/master/src/resolvers.ts),
  [InferCradleFromContainer](https://github.com/jeffijoe/awilix#infercradlefromcontainer).
- Lifetimes and scopes: [Lifetime management](https://github.com/jeffijoe/awilix#lifetime-management).
- Strict mode, off by default, and the lifetime leak error:
  [createContainer](https://github.com/jeffijoe/awilix#createcontainer),
  [Strict mode](https://github.com/jeffijoe/awilix#strict-mode).
- Async through a third-party package: [Ecosystem](https://github.com/jeffijoe/awilix#ecosystem).
- Disposal: [Disposing](https://github.com/jeffijoe/awilix#disposing).
- Browser build without `loadModules`:
  [Universal module](https://github.com/jeffijoe/awilix#universal-module-browser-support).

### InversifyJS

- Version 8.2.3; ESM only since v8:
  [Migrating from v7](https://inversify.io/docs/guides/migrating-from-v7/).
- Decorators and binding: [Getting started](https://inversify.io/docs/introduction/getting-started/).
- Decorators and reflect-metadata required: [Requirements](https://inversify.io/docs/faq/requirements/).
- Typed binding map (opt-in): [Strongly typed](https://inversify.io/docs/ecosystem/strongly-typed/).
- Scopes and child containers: [Binding](https://inversify.io/docs/fundamentals/binding/),
  [DI hierarchy](https://inversify.io/docs/fundamentals/di-hierarchy/).
- No lifetime check: the core's error kinds have none
  ([InversifyCoreErrorKind](https://github.com/inversify/monorepo/tree/main/packages/container/libraries/core)).
- Async: [Asynchronously resolved bindings](https://inversify.io/docs/fundamentals/binding/#asynchronously-resolved-bindings).
- Disposal: [Deactivation](https://inversify.io/docs/fundamentals/lifecycle/deactivation/),
  [plugin-dispose](https://github.com/inversify/monorepo/tree/main/packages/container/libraries/plugin-dispose).

### tsyringe

- Version 4.10.0; no code changes since that release:
  [commits](https://github.com/microsoft/tsyringe/commits/master).
- Decorators, emitted types and a Reflect polyfill required:
  [Installation](https://github.com/microsoft/tsyringe#installation).
- Untyped tokens, runtime errors:
  [dependency-container.ts](https://github.com/microsoft/tsyringe/blob/master/src/dependency-container.ts).
- Scopes and child containers: [Scoped](https://github.com/microsoft/tsyringe#scoped),
  [Child containers](https://github.com/microsoft/tsyringe#child-containers).
- Synchronous factories only: [Factory provider](https://github.com/microsoft/tsyringe#factory-provider).
- Disposal: [Disposable instances](https://github.com/microsoft/tsyringe#disposable-instances).

### NestJS

- Version 12.3.2: [npm](https://www.npmjs.com/package/@nestjs/core).
- Providers resolved by type: [Dependency injection](https://docs.nestjs.com/providers#dependency-injection).
- Missing providers fail at bootstrap: [Common errors](https://docs.nestjs.com/faq/common-errors#cannot-resolve-dependency-error).
- Decorators and emitted metadata: [TypeScript starter](https://github.com/nestjs/typescript-starter/blob/master/tsconfig.json).
- Scopes, and "The `REQUEST` scope bubbles up the injection chain":
  [Injection scopes](https://docs.nestjs.com/fundamentals/injection-scopes#scope-hierarchy).
- Async providers: [Async providers](https://docs.nestjs.com/fundamentals/async-providers).
- Lifecycle hooks: [Lifecycle events](https://docs.nestjs.com/fundamentals/lifecycle-events).

### Effect

- Version 4.1.1; v4 replaced `Context.Tag` and `Effect.Service` with `Context.Service`:
  [services migration](https://github.com/Effect-TS/effect/blob/main/migration/services.md).
- Services and the compile-time requirement check:
  [Services](https://effect.website/docs/v4/requirements-management/services/).
- Layers and memoization: [Layers](https://effect.website/docs/v4/requirements-management/layers/),
  [Layer memoization](https://effect.website/docs/v4/requirements-management/layer-memoization/).
- Scopes and finalizers: [Scope](https://effect.website/docs/v4/resource-management/scope/).

### injecute

- Wiring and types: [Design principles](./principles.md), [TypeScript](../guide/typescript.md).
- Scopes: [Scoped state](../guide/request-state.md#scopes),
  [Overriding a parent's service in a fork](../guide/containers.md#overriding-a-parent-s-service-in-a-fork).
- Async: [Async services](../guide/async.md). Disposal: [Lifecycle and dispose](../guide/lifecycle.md).
- Runtimes: [Versioning and support](../guide/versioning.md#runtimes).
