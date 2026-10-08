---
title: Custom registration
description: Build your own way to register services (files in a directory, standard decorators) as a module applied with extend(), what the compiler still checks, and when a middleware fits instead.
---

# Custom registration

injecute registers services with explicit `add*` calls. When you want services to be found instead
(files in a directory, classes with decorators, a manifest, a list of plugins), build that on top of the
public API. There are two places to plug it in:

| You want to                                        | Use                              | Types                                                     |
| -------------------------------------------------- | -------------------------------- | --------------------------------------------------------- |
| register services you can find when the app starts | a module applied with `extend()` | declared once by the module, then inferred like any other |
| answer for keys nobody can list in advance         | a middleware added with `use()`  | not in the container's type: every `get()` needs a cast   |

**Use a module by default.** It finds what to register and calls `addSingleton()` or `addTransient()`.
From then on these are ordinary registrations: they are created lazily, cached, released by
`dispose()`, shared with forks and replaced in [isolated forks](./testing.md), and `has()`,
`preload()` and `buildServicesGraph()` see them.

The compiler can't see what is found at runtime, so the module declares what it adds: it returns a
`ServiceRegistry<Requires, Services>`. How much of that declaration the compiler can check depends on
the approach. The two examples below show both ends.

## Services from files

Each file in `services/` is a service: the file name is the key, the default export is the factory and
`dependencies` lists the keys the factory receives, in order.

::: code-group

<<< @/../examples/custom-registration/services/clock.ts [services/clock.ts]

<<< @/../examples/custom-registration/services/greeter.ts [services/greeter.ts]

:::

A loader imports the files, and a module registers them:

<<< @/../examples/custom-registration/file-system.ts#add-service-files

The app declares the services from the files' own types and applies the module:

<<< @/../examples/custom-registration/file-system.ts#file-system

- **Checked:** the type of each service (taken from its file, so a changed factory changes it), and
  that the container has what the files need (`Requires`) when you call `extend()`.
- **Not checked:** that a file exists for every declared key, and that `dependencies` match the
  factory's parameters. A missing file fails with `INJECUTE_NOT_REGISTERED` when something resolves
  it. Write a test that resolves every declared service to catch both before deploying.
- `extend()` is synchronous: load the files first (`await`), then apply the module.
- Bundled apps and browsers can't read a directory. With Vite,
  `import.meta.glob('./services/*.ts', { eager: true })` returns the same modules at build time.

## Services from decorators

Standard decorators (TC39, TypeScript 5 and later without `experimentalDecorators`) don't emit the
types of constructor parameters, so a decorator can't infer what a class needs. Each decorator names
its key and its dependency keys, as `addSingleton()` does, and the compiler checks them against the
class.

`createDecorators()` is about 50 lines. Copy it into your project and adapt it:

<<< @/../examples/custom-registration/decorators.ts#create-decorators

Declare the services once, decorate the classes and apply the decorators as a module:

<<< @/../examples/custom-registration/decorators.ts#decorators

[Open in the playground](../playground?example=custom-registration/decorators): the example is
one file, with `createDecorators()` at the top.

- **Checked:** the key is one of `Services`. Each dependency key is in `Services` or `Requires`. The
  constructor accepts those services in that order, and its instances are the declared service. The
  container has `Requires` when you call `extend()`, and has `Services` afterwards.
- **Not checked:** that every key of `Services` has a decorated class. A decorator runs when its file
  is evaluated, so a class whose file nobody imports is never registered, and resolving it fails with
  `INJECUTE_NOT_REGISTERED`. Import every decorated file from the wiring file that calls `extend()`.
- Two classes under the same key fail with `INJECUTE_ALREADY_REGISTERED` at `extend()`.
- The decorators only collect registrations. Instances live in the container that applies them, so
  every container, fork and test gets its own.

Mistakes are compile errors at the decorator:

```ts
@services.singleton('mailer') // not a key of Services
class Mailer {}

@services.singleton('greeter', ['clock']) // the constructor needs (Config, Clock)
class Greeter {
  constructor(config: Config, clock: Clock) {}
}
```

```text
Argument of type '"mailer"' is not assignable to parameter of type 'keyof Services'.

Unable to resolve signature of class decorator when called as an expression.
  Argument of type 'typeof Greeter' is not assignable to parameter of type 'new (args_0: Clock) => Greeter'.
```

What this costs:

- The wiring moves from one file into the classes, and the classes import the decorators. You lose
  "readable in one place" ([principles 1 and 2](../concepts/principles.md)).
  The classes themselves stay plain: a test still creates them with `new Greeter(config, clock)`.
- Standard decorators must be compiled. `tsc` compiles them. Node.js (including its type stripping)
  doesn't run them yet, and Vite 8 and Vitest 5 compile only legacy decorators. In Vite or Vitest,
  compile files that use decorators with TypeScript first:

<<< @/../vitest.config.ts#standard-decorators

## Keys nobody can list: a middleware

When the keys come from outside and can't be listed at startup, such as environment variables or
remote settings looked up by name, a middleware can answer for them:

<<< @/../examples/middleware/fallback.ts#fallback

A middleware is the right tool only when the keys really are unknown up front:

- The keys aren't in the container's type, so every `get()` needs a cast. Wrap the lookup in a typed
  function instead of casting at every call site.
- It runs on every `get()` and caches nothing. Cache values yourself if they are expensive.
- The values aren't registrations: `has()`, `preload()` and `buildServicesGraph()` don't know them, and
  `dispose()` doesn't release them.

If you can list the keys when the app starts, even by computing them, register them in a module
instead. For example, read the environment once and call `addInstance()` for every variable. See
[Middlewares and events](./middleware-events.md) for what else middlewares do.
