---
name: injecute
description: Writes, reviews and debugs TypeScript code that uses the injecute dependency injection container (DIContainer, addSingleton, fork, extend, ServiceRegistry, ServiceProvider). Use when a project depends on injecute, when wiring services, modules, request context (AsyncLocalStorage) or per-request forks, when writing tests that override container services, or when fixing INJECUTE_* errors.
license: MIT
metadata:
  library-version: '1.x'
---

# Writing code with injecute

injecute is a type-safe dependency injection container without decorators. Each service is registered
with a **key**, a **factory** (a function or a class) and the **keys it depends on**. The container type
grows with every registration, so `get()` results and factory parameters are inferred.

## First, check the version

Look at `injecute` in `package.json`.

- **1.x**: follow this skill. The installed version's docs are in `node_modules/injecute/llms.txt`
  (an index) and `node_modules/injecute/lib/docs/`. Read the relevant page before using an API you
  are unsure about; the type declarations (`node_modules/injecute/lib/index.d.ts`) have TSDoc on every
  export.
- **0.x**: the API differs; to upgrade, follow `lib/docs/migration/0.x-to-1.0.md` (online: https://masyaka.github.io/injecute/migration/0.x-to-1.0). Don't apply 1.x patterns to 0.x code.

Online docs: https://masyaka.github.io/injecute/ (`/llms.txt`, `/llms-full.txt`).

## The API in one example

```ts
import {
  DIContainer,
  optional,
  type ServiceProvider,
  type ServiceRegistry,
} from 'injecute';

class Database {
  constructor(readonly url: string) {}
}
class UserRepository {
  constructor(private readonly db: Database) {}
}

// The composition root: build the container in one chain, so its type has every service.
const app = new DIContainer()
  .addInstance('dbUrl', process.env.DATABASE_URL ?? 'postgres://localhost/app') // a ready value
  .addSingleton('db', Database, ['dbUrl']) // created once (new Database(dbUrl)), then cached
  .addTransient('requestId', () => crypto.randomUUID()) // created on every resolution
  .addSingleton('users', UserRepository, ['db'])
  .addSingleton('mailer', (transport) => createMailer(transport), [
    optional('transport'),
  ]);

const users = app.get('users'); // UserRepository
```

## Rules

**Registration**

1. Pass dependency keys as the third argument, in the factory's parameter order:
   `addSingleton('repo', Repo, ['db', 'logger'])`. The options form is
   `addSingleton(key, factory, { dependencies, replace, dispose })`.
2. Register classes directly: `addSingleton('users', UserRepository, ['db'])`. Use
   `construct(MyClass)` only for classes compiled to ES5 or bound classes (they look like functions).
3. `addInstance(key, value)` for existing values. The container does not dispose them unless you pass
   `{ dispose: true }` (or a function).
4. Keep the chain. Every `add*` returns the container with a larger type. `const c = new DIContainer();
c.addInstance('a', 1); c.get('a')` registers `a` but does not type-check. Chain, or reassign:
   `const c2 = c.addInstance('a', 1)`.
5. Registering a key twice in the same container throws `INJECUTE_ALREADY_REGISTERED`. Pass
   `{ replace: true }` to replace it. A fork may register a key its parent has without `replace`.
6. A dependency on the key being registered receives its **previous definition**, so decoration is:
   `.addSingleton('logger', (logger) => withPrefix(logger), { replace: true, dependencies: ['logger'] })`.
7. Optional dependencies are `optional('key')` (the service, or `undefined`). A function dependency
   `() => value` passes its result. `get(key, { optional: true })` returns `undefined` for a missing key.
8. `addAlias('logger', 'jsonLogger')` points one key at another service.

**Who gets which type**

9. Only the composition root holds the `DIContainer` (middlewares, events, `fork`, `reset`, `dispose`).
10. Modules are plain, non-generic functions over the services they need, applied with `extend()`:

    ```ts
    const addBilling = (c: ServiceRegistry<{ db: Database }>) =>
      c.addSingleton('invoices', InvoiceRepository, ['db']);

    const withBilling = app.extend(addBilling); // compile error if `db` is not registered
    ```

    Return the registry the function received (the `add*` chain does that).

11. Code that only resolves services takes a `ServiceProvider<{ users: UserRepository }>`. Use plain
    `ServiceProvider` (no type argument) to accept any container.
12. `namespace('Billing', (c) => c.addSingleton(...))` registers `Billing.key` for each service and
    `Billing` for the namespace's provider (`app.get('Billing')`). In `ContainerServices`, `Billing` is a
    `Namespace` marker; `NamespaceServices<typeof app, 'Billing'>` is the namespace's service map.
13. `ContainerServices<typeof app>` is the service map of a container type. End the composition root
    with `.seal()`: no more registrations in it (forks stay open), and its type is one flat, faster
    service map. A package that exports a container also names the map,
    `interface AppServices extends ContainerServices<typeof built> {}`, so its `.d.ts` refers to it.

**Request context, scopes, tests and cleanup**

14. Request data that services read (trace id, tenant, user) goes in a **context accessor**, not a fork.
    The app defines the type (`interface ContextAccessor<T> { current(): T | undefined }`) and its
    modules declare it: `ServiceRegistry<{ context: ContextAccessor<RequestContext> }>`. The host
    registers it first, backed by `AsyncLocalStorage`, runs each request in `storage.run(context, …)`
    and creates the singletons at startup with `await preload(app)`:

    ```ts
    const storage = new AsyncLocalStorage<RequestContext>();
    const app = new DIContainer()
      .addInstance('context', { current: () => storage.getStore() })
      .extend(addOrders); // type error if the module needs a service the host lacks
    ```

    Services call `context.current()` when they use it. Never register the context value as a
    singleton, read it in a factory or constructor, or keep it in a field: the first request's context
    would stick. Use `run()`, not `enterWith()`.

15. For state that belongs to one request, try these before a fork per request, in this order: pass it
    as an argument; register a factory and let the caller own the instance with `using`
    (`using work = unitOfWork.begin()`, a unit of work for a transaction); read it from the context
    accessor; keep one instance per context in a singleton (a `WeakMap` keyed by the context object, for
    caches and DataLoaders); pick a per-tenant implementation in a singleton by the context (Strategy).
    Forks per request make the container structure hard to follow.
16. `app.fork()` is a child container: it sees the parent's services and shares the parent's singletons;
    what it registers stays in the fork, and parent services can't depend on it. Fork per request only
    for a group of services that share per-request instances and depend on the app's services; fork the
    root in one place and dispose it: `await using scope = app.fork().addSingleton('tx', …)`.
17. In tests, override with an isolated fork. Every service it resolves is built inside the fork, so the
    override reaches the whole graph and `app` is untouched:

    ```ts
    await using test = app
      .fork({ isolated: true })
      .addInstance('db', fakeDb, { replace: true });
    test.get('users'); // built with fakeDb
    ```

18. `await app.dispose()` (or `await using`) disposes the singletons the container created, in reverse
    creation order, via `[Symbol.asyncDispose]` / `[Symbol.dispose]` or the `dispose` option. Transient
    services are not kept, so they can't have a `dispose` option.
19. `reset()` clears cached instances (`reset({ keys: ['db'] })` for some).

**Middlewares and events**

20. A middleware is `(key, next, { container, path, depth }) => value`. Call `next()` to continue (or
    `next(otherKey)`) and return its result. Arrow functions are fine; there is no `this`.
21. Add middlewares on the root with `use()`; forks inherit them live. `fork({ middlewares: false })`
    opts out; `unuse(middleware)` removes one.
22. `addEventListener('produce' | 'get' | 'add' | 'replace' | 'reset' | 'dispose', listener)` observes a
    container.

**Async**

23. In a `DIContainer`, a factory may return a promise; dependents then receive the promise. Wrap a
    factory with `defer(factory)` to await its promised arguments; `get()` of that service returns a
    promise. A rejected singleton is retried on the next `get()`; `dispose()` releases resolved values.
24. When much of the graph is async, use `new AsyncDIContainer()`: factories receive resolved
    dependencies, a factory returning `Promise<T>` registers `T`, and every `get()` returns a promise.
    Its modules take `AsyncServiceRegistry<{ … }>`, consumers `AsyncServiceProvider<{ … }>`; the sync
    `ServiceRegistry` / `ServiceProvider` types don't accept it. `await preload(app)` at startup.

**Errors**

25. Every error is an `InjecuteError` with a stable `code`, the resolution `path` and a `docs` link.
    Branch on `error.code`, never on the message. Errors thrown by factories arrive wrapped as
    `INJECUTE_RESOLUTION_FAILED`; the original error is `error.cause`.

## Fixing errors

| You see                                                         | Fix                                                                                            |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Type error on a dependency key, "Did you mean …?"               | The key is not registered before this call, or is misspelled. Register it earlier in the chain |
| `injecute: extension requires services that are not registered` | Register the listed keys before `extend()` / `namespace()`                                     |
| `INJECUTE_NOT_REGISTERED`                                       | Register the key, fix the typo (the message suggests keys), or resolve it as optional          |
| `INJECUTE_ALREADY_REGISTERED`                                   | Pass `{ replace: true }`, or register in a fork                                                |
| `INJECUTE_CIRCULAR_DEPENDENCY`                                  | Extract the shared part into its own service, or resolve one side lazily (`() => c.get(k)`)    |
| `INJECUTE_CLASS_NOT_CONSTRUCTED`                                | The class is ES5-compiled or bound: register `construct(MyClass)`                              |
| `INJECUTE_RESOLUTION_FAILED`                                    | A factory threw; read `error.cause` and `error.path`                                           |

Each code has a page: `node_modules/injecute/lib/docs/errors/<slug>.md` (for example
`INJECUTE_NOT_REGISTERED` → `not-registered.md`), online at `https://masyaka.github.io/injecute/errors/<slug>`.

## Don't

- Don't add decorators, `reflect-metadata` or parameter-name reflection: injecute doesn't use them.
- Don't pass the `DIContainer` to modules or handlers; give them `ServiceRegistry<…>` / `ServiceProvider<…>`.
- Don't write `IDIContainer` (deprecated), `new DIContainer({ parentContainer })`, `'undefined'`
  dependency keys, `allowUnresolved`, `flatten()` or `function (key, next) { this… }` middlewares: they
  are 0.x APIs.
- Don't make module functions generic over the container type (`<T extends …>(c: IDIContainer<T>)`).
