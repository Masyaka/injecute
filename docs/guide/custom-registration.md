---
title: Custom registration
description: Build your own way to register services (files in a directory, wiring generated from files, standard decorators) as a module applied with extend(), what the compiler still checks, and when a middleware fits instead.
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
the approach. The examples below show both ends, and how generating the wiring from files gets the
compiler's full checks back.

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
  it. [Check the wiring](#checking-the-wiring) in a test to catch it before deploying, or
  [generate the wiring](#generating-the-wiring-from-files) and the compiler checks both.
- `extend()` is synchronous: load the files first (`await`), then apply the module.
- Bundled apps and browsers can't read a directory. With Vite,
  `import.meta.glob('./services/*.ts', { eager: true })` returns the same modules at build time.

## Generating the wiring from files

Instead of loading the files when the app starts, a script can write the wiring from them: plain
`addSingleton()` calls, as you would write them by hand. The compiler then checks the generated file like
any other wiring.

**For files in your project, generate the wiring.** Load files at runtime only when they aren't known
before the app starts, such as plugins installed later.

The script reads the same files as the loader above: the file name is the key, the default export the
factory, and `dependencies` the keys it receives. It orders the registrations so each service comes after
its dependencies, and keys that no file provides become the module's requirements:

<<< @/../examples/custom-registration/codegen/generate-wiring.ts#generate-wiring

For the two files above, it writes:

<<< @/../examples/custom-registration/codegen/services.generated.ts

The app applies it like any module, without declaring `Services`:

<<< @/../examples/custom-registration/codegen/app.ts#codegen

- **Checked:** everything the compiler checks in hand-written wiring. `dependencies` that don't match
  the factory's parameters are an error at that service's `addSingleton()`. A dependency that no file
  and no registration provides is an error at `extend()`, and so is `get()` with a key that has no file.
- **Not checked:** that the wiring file is up to date with the files. Run the script before type
  checking, or compare its output with the committed file in a test:

  ```ts
  it('the wiring file is up to date', async () => {
    const output = new URL('./services.generated.ts', import.meta.url);
    const source = await generateWiring(
      new URL('./services/', import.meta.url),
      output,
    );
    expect(source).toBe(await readFile(output, 'utf8'));
  });
  ```

- The script imports the files to read `dependencies`: run it with a runtime that runs TypeScript, such
  as Node.js 22.18 or later, Deno or Bun. File names must be valid identifiers.
- The wiring is ordinary imports, so bundlers and browsers need nothing extra.

Mistakes in the files are compile errors. Dependencies in the wrong order:

```ts
export const dependencies = ['clock', 'config']; // the factory takes (config, clock)
```

```text
services.generated.ts: Argument of type '(config: { greeting: string; }, clock: { now: () => Date; }) => …'
  is not assignable to parameter of type 'Factory<["clock", "config"], …>'.
    Types of parameters 'config' and 'args_0' are incompatible.
```

A dependency that no file provides and the app doesn't register:

```ts
export const dependencies = ['config', 'clock', 'mailer']; // there is no services/mailer.ts
```

```text
app.ts: Argument of type '(registry: ServiceRegistry<Requires>) => …' is not assignable to parameter
  of type '{ 'injecute: extension requires services that are not registered': "mailer"; }'.
```

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
  `INJECUTE_NOT_REGISTERED`. Import every decorated file from the wiring file that calls `extend()`,
  and [check the wiring](#checking-the-wiring) in a test.
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

## Testing

Services registered by a module are ordinary registrations, however the module found them. Tests work
as described in [Testing](./testing.md): replace a dependency in an isolated fork, and everything
resolved through the fork uses the replacement.

<<< @/../examples/custom-registration/decorators.ts#testing

The same works for services registered from files.

### Checking the wiring

The compiler checks what you declare in `Services`, but not that every declared service is actually
registered. List the keys in an object that `satisfies Record<keyof Services, true>`: the compiler then
checks the list against `Services`, so a declared service can't be left out. Pass the list to
[`checkWiring()`](./testing.md#check-the-wiring) in a test:

<<< @/../examples/custom-registration/file-system.ts#check-wiring

- **A declared service without a file or decorated class** is reported as not registered.
- **A dependency key that nothing registers** (a typo in `dependencies`) is reported with every service
  that needs it. Neither check runs a factory.
- **Dependencies in the wrong order** are caught only if the factory fails with them: pass
  `resolve: true` to run every factory (on an [isolated fork](./testing.md) with fakes). With files,
  nothing compares `dependencies` with the factory's parameters; with the decorators, the compiler does.
- The same check works for decorated classes: list the keys of the `Services` you passed to
  `createDecorators()`.

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
