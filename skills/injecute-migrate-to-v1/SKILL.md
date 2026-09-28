---
name: injecute-migrate-to-v1
description: Migrates a codebase from injecute 0.x to injecute 1.0, step by step, with search patterns and before/after code for every breaking change (ESM only, ServiceRegistry/ServiceProvider types, classes without construct(), optional(key), renamed options, middleware signature, fork({ isolated }), InjecuteError codes). Use when upgrading the injecute dependency to 1.x or when code uses IDIContainer, allowUnresolved, parentContainer, flatten() or 'undefined' dependency keys.
license: MIT
metadata:
  library-version: '0.x to 1.0'
---

# Migrating injecute 0.x → 1.0

Work through the steps in order. Steps 1-8 are mechanical; step 9 lists behaviour changes to review.
After each step, run the project's typecheck; TypeScript finds most of what is left.

The full guide, with an explanation of each change, is `node_modules/injecute/lib/docs/migration/0.x-to-1.0.md`
once 1.x is installed (online: https://masyaka.github.io/injecute/migration/0.x-to-1.0).

## 0. Scope

Find every file that uses injecute (use `rg`, or grep with the same patterns):

```sh
rg -l "from ['\"]injecute['\"]|require\(['\"]injecute['\"]\)"
```

## 1. Runtime, TypeScript and install

- injecute 1.x needs **Node.js ≥ 22** (or Deno, Bun, a modern browser) and **TypeScript ≥ 5.2**.
- It is ESM only. `require('injecute')` still works on Node ≥ 22 (`require(esm)`), so CommonJS
  projects don't need to change module format.
- Install it: `npm install injecute@^1` (or the project's package manager).

## 2. Imports

| Search                                        | Replace with                                                       |
| --------------------------------------------- | ------------------------------------------------------------------ |
| `import DIContainer from 'injecute'`          | `import { DIContainer } from 'injecute'`                           |
| `import { utils } from 'injecute'`, `utils.x` | import each helper by name: `import { construct } from 'injecute'` |

```sh
rg "import\s+\w+\s*(,\s*\{[^}]*\})?\s*from\s+['\"]injecute['\"]"
rg "\butils\.(construct|defer|preload|createProxyAccessor|createNamedResolvers|createResolversTuple|addNamedResolvers|setCacheInstance|buildServicesGraph)\b"
```

## 3. Container types: `IDIContainer` → `ServiceRegistry` / `ServiceProvider`

```sh
rg "IDIContainer|DIContainer<[^>]*,"
```

- A function that **registers** services (a module or extension) takes `ServiceRegistry<{ …what it needs }>`
  and is no longer generic. Apply it with `extend()`:

  ```ts
  // before
  const addBilling = <T extends { db: Database }>(c: IDIContainer<T>) =>
    c.addSingleton('invoices', construct(InvoiceRepository), ['db']);

  // after
  const addBilling = (c: ServiceRegistry<{ db: Database }>) =>
    c.addSingleton('invoices', InvoiceRepository, ['db']);
  app.extend(addBilling);
  ```

- A function that only **resolves** services takes `ServiceProvider<{ … }>` (plain `ServiceProvider`
  accepts any container).
- `DIContainer<TOwn, TParent>` has one type parameter now: `DIContainer<S>`.
- `IDIContainer` still compiles (a deprecated alias of `ServiceRegistry`), so this step can be done
  gradually.

## 4. Classes: drop `construct()` for native classes

```sh
rg "construct\("
```

`addSingleton('users', construct(UserRepository), ['db'])` → `addSingleton('users', UserRepository, ['db'])`.

**Keep** `construct()` for classes compiled to ES5 (TypeScript `target: "es5"`, Babel for old browsers,
often third-party packages) and for bound classes (`MyClass.bind(…)`). If unsure whether a class comes
from ES5 output, keep `construct()`: it is still correct for native classes.

## 5. Optional dependencies: `'undefined'` → `optional(key)`

```sh
rg "['\"]undefined['\"]"
```

In a dependency array, `'undefined'` was a magic key. Replace it with `optional('someKey')` (the service
when it is registered) or `() => undefined` (always `undefined`). Import `optional` from `injecute`.

```ts
// before
app.addSingleton('mailer', construct(Mailer), ['undefined']);
// after
app.addSingleton('mailer', Mailer, [optional('transport')]);
```

## 6. Renamed options and removed APIs

```sh
rg "allowUnresolved|parentContainer|skipResolvers|flatten\(|getFactory|entryTypeKey|firstResult|EntryType|beforeResolving|afterResolving|beforeReplaced|ArgumentsKey|DependenciesToTypes|\bEvents<|\.has\([^)]*,\s*(true|false)\)"
```

| 0.x                                                             | 1.0                                                          |
| --------------------------------------------------------------- | ------------------------------------------------------------ |
| `get(key, { allowUnresolved: true })`                           | `get(key, { optional: true })`                               |
| `createProxyAccessor(c, { allowUnresolved })`                   | `createProxyAccessor(c, { optional })`                       |
| `has(key, false)`                                               | `has(key, { local: true })`                                  |
| `has(key, true)`                                                | `has(key)`                                                   |
| `new DIContainer({ parentContainer: parent })`                  | `parent.fork()`                                              |
| `fork({ skipResolvers: true })`                                 | `fork({ middlewares: false })`                               |
| `flatten(…)`                                                    | `fork({ isolated: true })`                                   |
| `getFactory(key)`, `entryTypeKey`, `firstResult`                | `getRegistration(key)` (`kind`, `dependencies`, `target`, …) |
| `EntryType`                                                     | `RegistrationKind`                                           |
| `beforeResolving` / `afterResolving` / `beforeReplaced` options | a middleware, or the `produce` / `replace` events            |
| `replace` event `replaced: { callable, type }`                  | `previous: RegistrationInfo`                                 |
| `ArgumentsKey`                                                  | `ServiceKey`                                                 |
| `DependenciesToTypes<Keys, S>`                                  | `ResolveDependencies<Keys, S>`                               |
| `Events<C>`                                                     | `ContainerEvents`                                            |

Removed helper types (`Callable`, `Func`, `Constructor`, `Flatten`, `Merge`, `IDIContainerExtension`,
`ContainerOwnServices`, …): use `Factory<D, S>`, `Produced<F>`, `ResolveDependencies<D, S>`,
`ContainerServices<C>` and the option types (`SingletonOptions`, `ForkOptions`, …). The full list is in
the migration guide.

## 7. Middlewares: `(key, next, context)`

```sh
rg "\.use\("
```

Middlewares no longer get the container as `this`. Read it from the third argument; `next()` continues
with the same key.

```ts
// before
container.use(function (key, next) {
  this.get('logger').debug(String(key));
  return next(key);
});

// after
container.use((key, next, { container, path }) => {
  container.get('logger').debug(path.join(' > '));
  return next();
});
```

Register middlewares on the root container. `use()` works anywhere in the chain now.

## 8. Errors: branch on `code`

```sh
rg "catch|\.message|CircularDependencyError"
```

- Every error is an `InjecuteError` with a stable `code` (`INJECUTE_NOT_REGISTERED`, …), `path` and `docs`.
  Replace checks on message text (`/No service registered/`, `includes('Circular')`) with
  `error instanceof InjecuteError && error.code === 'INJECUTE_…'`. `CircularDependencyError` still exists.
- Errors thrown by **your factories** now arrive wrapped as `INJECUTE_RESOLUTION_FAILED`. Code that
  catches its own error types around `get()` must check `error.cause`:

  ```ts
  // before
  catch (e) { if (e instanceof ConfigError) … }
  // after
  catch (e) { const cause = e instanceof InjecuteError ? e.cause : e; if (cause instanceof ConfigError) … }
  ```

## 9. Behaviour changes to review

These compile unchanged; check whether the code relied on the old behaviour.

- **`null` / `undefined` are valid values.** A factory returning `null` is cached and returned; 0.x
  threw "not registered" and re-ran the factory.
- **Self dependency = previous definition.** `addSingleton('logger', f, { replace: true, dependencies: ['logger'] })`
  receives the replaced `logger` (or the parent's in a fork). Re-registering a key without
  `{ replace: true }` throws `INJECUTE_ALREADY_REGISTERED`.
- **Middlewares run once per `get()`**, and forks inherit them **live** (a middleware added to a parent
  later applies to existing forks). Counters or logs that expected repeated calls change.
- **Error messages changed** (they now include a hint and a docs link).
- **Classes are constructed with `new`** automatically, so a class registered without `construct()`
  that 0.x called as a function now works instead of throwing.

## 10. Verify

1. Run the typecheck and the tests.
2. Re-run the searches from steps 2-8; the only matches left should be intended (`construct()` for ES5
   classes, `IDIContainer` you chose to keep for now).
3. If tests override services by mutating the app container, prefer an isolated fork:
   `await using test = app.fork({ isolated: true }).addInstance('db', fake, { replace: true })`.
