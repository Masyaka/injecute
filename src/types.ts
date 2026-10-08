import type { AsyncDIContainer } from './async-container.ts';
import type { DIContainer } from './container.ts';
import type {
  AliasTarget,
  AsyncExpectedService,
  ExpectedService,
  RegisteredKey,
  TaggedKey,
} from './tagged-keys.ts';

// ------------------------------------------------------------------------------------------- keys

/** A service key: the name a service is registered and resolved under. */
export type ServiceKey = string | number | symbol;

/** @deprecated Renamed to {@link ServiceKey}. */
export type ArgumentsKey = ServiceKey;

// ----------------------------------------------------------------------------------- dependencies

declare const optionalDependencyBrand: unique symbol;

/** A dependency created by {@link optional}: resolves to the service, or `undefined` when it is not registered. */
export interface OptionalDependency<K extends ServiceKey = ServiceKey> {
  readonly [optionalDependencyBrand]: K;
}

declare const collectDependencyBrand: unique symbol;

/**
 * A dependency created by {@link collect}: resolves to every service registered under a tag.
 *
 * @example
 * ```ts
 * const routes: CollectDependency<Route> = collect(route);
 * app.addSingleton('router', (all) => new Router(all), [routes]); // all: Route[]
 * ```
 */
export interface CollectDependency<T = unknown> {
  readonly [collectDependencyBrand]: T;
}

declare const tagType: unique symbol;

/**
 * A tag, made by {@link createTag}: a name for an extension point. Calling it builds the key of a
 * service under the tag (`route('orders')` is `'orders:route'`); `collect(tag)` gives a factory every
 * service registered under it, as an array of `T`.
 *
 * @example
 * ```ts
 * export const route = createTag('route').of<Route>();
 *
 * c.addSingleton(route('orders'), (): Route => ordersRoute); // the key 'orders:route'
 * c.addSingleton('router', (routes) => new Router(routes), [collect(route)]); // routes: Route[]
 * ```
 */
export interface Tag<T = unknown, N extends string = string> {
  /**
   * The key of a service under this tag: `name:<tag>`. It carries the tag's type, so `addSingleton()`
   * checks the service registered under it.
   */
  <const K extends string>(name: K): `${K}:${N}` & TaggedKey<T, `${K}:${N}`>;
  /** The tag's name: the suffix of the keys it builds. */
  readonly tagName: N;
  /** The same tag, typed for services of type `U`: `createTag('route').of<Route>()`. */
  of<U>(): Tag<U, N>;
  /** Type only: the type of the services under this tag. */
  readonly [tagType]?: T;
}

/**
 * What a registration can depend on:
 * - a service key: the factory receives that service
 * - `optional(key)`: the service, or `undefined` when it is not registered
 * - `collect(tag)`: every service registered under the tag, in registration order
 * - a function: called on each resolution, the factory receives its result
 *
 * `A` is a registry's own additions, on top of the services `S` it was given (see {@link ServiceRegistry}).
 *
 * (`() => any` rather than `() => unknown` keeps typos in keys reported on the key itself.)
 */
export type Dependency<S, A = {}> =
  keyof S | keyof A | OptionalDependency | CollectDependency | (() => any);

/**
 * The value a single {@link Dependency} resolves to. Keys are looked up in `A` (a registry's own
 * additions) first, then in `S`.
 */
export type ResolveDependency<D, S, A = {}> =
  D extends CollectDependency<infer T>
    ? T[]
    : D extends OptionalDependency<infer K>
      ? RegisteredKey<K> extends infer P extends keyof A
        ? ServiceType<A, P> | undefined
        : RegisteredKey<K> extends infer P extends keyof S
          ? ServiceType<S, P> | undefined
          : undefined
      : D extends () => infer R
        ? R
        : RegisteredKey<D> extends infer P extends keyof A // a key built by a tag: its plain key
          ? ServiceType<A, P>
          : RegisteredKey<D> extends infer P extends keyof S
            ? ServiceType<S, P>
            : never;

/** The factory arguments a dependency list resolves to (see {@link ResolveDependency} for `A`). */
export type ResolveDependencies<D extends readonly unknown[], S, A = {}> = {
  -readonly [I in keyof D]: ResolveDependency<D[I], S, A>;
};

/** @deprecated Renamed to {@link ResolveDependencies}. */
export type DependenciesToTypes<
  D extends readonly unknown[],
  S,
> = ResolveDependencies<D, S>;

// ------------------------------------------------------------------------------------- factories

/**
 * Creates a service from its resolved dependencies: a function, or a class (called with `new`).
 * `A` is a registry's own additions (see {@link ResolveDependency}); `R` is what it must produce (the
 * tag's type, for a key built by a tag).
 */
export type Factory<D extends readonly unknown[], S, A = {}, R = unknown> =
  | ((...args: ResolveDependencies<D, S, A>) => R)
  | (new (...args: ResolveDependencies<D, S, A>) => R);

/** What a {@link Factory} produces: the instance type of a class, or the return type of a function. */
export type Produced<F> = F extends abstract new (...args: any) => infer I
  ? I
  : F extends (...args: any) => infer R
    ? R
    : never;

// --------------------------------------------------------------------------------------- options

/**
 * How `dispose()` releases an instance: `true` (or unset, for singletons) calls
 * `[Symbol.asyncDispose]` / `[Symbol.dispose]` when present, `false` skips it, a function disposes with it.
 * When the service is a promise, the resolved value is disposed; a rejected one is skipped.
 */
export type DisposeOption<T> = boolean | ((instance: T) => unknown);

/** Options for {@link ServiceRegistry.addTransient}. */
export interface RegistrationOptions<D, R extends boolean = boolean> {
  /** Dependency keys, passed to the factory in the same order. */
  dependencies?: D;
  /**
   * Replace an existing registration of this key in the same container. With `replace: true` the
   * service's type becomes the new one (see {@link Registered}).
   */
  replace?: R;
}

/** Options for {@link ServiceRegistry.addSingleton}. */
export interface SingletonOptions<D, T> extends RegistrationOptions<D> {
  /** How `dispose()` releases the instance. Default: auto-detect `[Symbol.asyncDispose]` / `[Symbol.dispose]`. */
  dispose?: DisposeOption<T>;
}

/**
 * Options of `addSingleton(key, factory, options)`: {@link SingletonOptions} for the instance type
 * `factory` produces. The instance type is worked out only when an options object is passed, which
 * keeps registration chains cheap to typecheck.
 *
 * @example
 * ```ts
 * app.addSingleton('pool', createPool, {
 *   dependencies: ['config'],
 *   dispose: (pool) => pool.end(), // pool: Awaited<ReturnType<typeof createPool>>
 * });
 * ```
 */
export interface SingletonFactoryOptions<
  D,
  F,
  R extends boolean = boolean,
> extends RegistrationOptions<D, R> {
  /** How `dispose()` releases the instance. Default: auto-detect `[Symbol.asyncDispose]` / `[Symbol.dispose]`. */
  dispose?: DisposeOption<Awaited<Produced<F>>>;
}

/** Options for {@link ServiceRegistry.addInstance}. */
export interface InstanceOptions<T, R extends boolean = boolean> {
  /**
   * Replace an existing registration of this key in the same container. With `replace: true` the
   * service's type becomes the new one (see {@link Registered}).
   */
  replace?: R;
  /** The container does not own added instances; set this to dispose them with the container. Default: `false`. */
  dispose?: DisposeOption<T>;
}

/** Options for {@link ServiceProvider.get}. */
export interface GetOptions {
  /** Return `undefined` instead of throwing when the key is not registered. */
  optional?: boolean;
}

/** Options for {@link ServiceProvider.has}. */
export interface HasOptions {
  /** Only look at this container, not its parents. Default: `false`. */
  local?: boolean;
}

/** Options for `fork()`. */
export interface ForkOptions {
  /**
   * Run and own every service the fork resolves, including ones registered in its parents, so
   * overrides in the fork reach the whole graph and nothing leaks back. Default: `false`.
   */
  isolated?: boolean;
  /** Inherit middlewares from this container and its ancestors. Default: `true`. */
  middlewares?: boolean;
}

/** Options for `reset()`. */
export interface ResetOptions<S> {
  /** Only reset these keys. Default: every cached instance. */
  keys?: readonly (keyof S)[];
  /** Reset the parent containers too. Default: `false`. */
  resetParent?: boolean;
}

// ---------------------------------------------------------------------------------- introspection

/**
 * How a service was registered.
 * - `singleton` / `transient`: a factory, created once / on every resolution
 * - `instance`: a value added with `addInstance`
 * - `alias`: points to another key (`target`)
 * - `namespace`: a namespace container added with `namespace()`
 * - `namespace-entry`: `Namespace.key`, resolved from the namespace container
 * - `delegate`: a namespace service replaced by the parent container
 */
export type RegistrationKind =
  | 'singleton'
  | 'transient'
  | 'instance'
  | 'alias'
  | 'namespace'
  | 'namespace-entry'
  | 'delegate';

/** A dependency of a registration, as reported by {@link RegistrationInfo}. */
export type DependencyInfo =
  | { readonly type: 'key'; readonly key: ServiceKey }
  | { readonly type: 'collect'; readonly tag: string }
  | { readonly type: 'optional'; readonly key: ServiceKey }
  | { readonly type: 'previous'; readonly key: ServiceKey }
  | { readonly type: 'function'; readonly name: string };

/** Read-only metadata about a registration. Returned by {@link ServiceProvider.getRegistration}. */
export interface RegistrationInfo {
  /** The registered key. */
  readonly key: ServiceKey;
  /** How the service was registered. */
  readonly kind: RegistrationKind;
  /** The dependencies passed to the factory, in order. */
  readonly dependencies: readonly DependencyInfo[];
  /** 0 when registered in the container that was asked, 1 for its parent, and so on. */
  readonly depth: number;
  /** Alias target, or the key inside the namespace container. */
  readonly target?: ServiceKey;
  /** The namespace name, for `namespace` and `namespace-entry` registrations. */
  readonly namespace?: string;
  /** For `namespace-entry` and `delegate`: the registration it resolves to. */
  readonly linked?: RegistrationInfo;
}

// ------------------------------------------------------------------------------------ middleware

/** Context passed to a {@link Middleware}. */
export interface MiddlewareContext {
  /** The container the resolution runs in (read-only view). */
  readonly container: ServiceProvider<any>;
  /** Keys being resolved, outermost first; the last one is the current key. */
  readonly path: readonly ServiceKey[];
  /** Nesting level: 0 for a `get()` call, 1 for its dependencies, and so on. */
  readonly depth: number;
}

/**
 * Wraps resolution. Call `next()` to continue (or `next(otherKey)` to resolve another key) and return
 * the value. Returning without calling `next` replaces the resolution.
 *
 * @example
 * ```ts
 * const timing: Middleware = (key, next, { depth }) => {
 *   const start = performance.now();
 *   const value = next();
 *   console.debug(`${'  '.repeat(depth)}${String(key)} ${performance.now() - start}ms`);
 *   return value;
 * };
 * container.use(timing);
 * ```
 */
export type Middleware = (
  key: ServiceKey,
  next: (key?: ServiceKey) => unknown,
  context: MiddlewareContext,
) => unknown;

// ---------------------------------------------------------------------------------------- events

/** Event payloads, by event name. `container` is a read-only view of the container that emitted it. */
export interface ContainerEvents {
  /** A registration was added (or replaced, with `replace: true`). */
  add: {
    key: ServiceKey;
    replace: boolean;
    kind: RegistrationKind;
    container: ServiceProvider<any>;
  };
  /** A registration was replaced; `previous` describes the old one. */
  replace: {
    key: ServiceKey;
    previous: RegistrationInfo;
    container: ServiceProvider<any>;
  };
  /** Cached instances were cleared by `reset()`. */
  reset: {
    keys?: readonly ServiceKey[];
    resetParent: boolean;
    container: ServiceProvider<any>;
  };
  /** A service was resolved with `get()` (also fired for nested dependencies). */
  get: { key: ServiceKey; value: unknown; container: ServiceProvider<any> };
  /** A factory created a new instance. */
  produce: {
    key: ServiceKey;
    value: unknown;
    container: ServiceProvider<any>;
  };
  /** `dispose()` has released every owned instance. */
  dispose: { container: ServiceProvider<any> };
}

// ------------------------------------------------------------------------------------ containers

/**
 * Read-only access to a container's services: resolve and inspect, but not register or configure.
 *
 * Give it to code that only consumes services (handlers, middleware context, tooling).
 * A provider of more services is assignable to a provider of fewer, so declare what you need:
 *
 * @example
 * ```ts
 * function createHandler(services: ServiceProvider<{ users: UserRepository }>) {
 *   return (id: string) => services.get('users').find(id);
 * }
 * createHandler(app); // app has `users` and more
 * ```
 */
export interface ServiceProvider<S extends object = {}> {
  /**
   * Resolves a service. Throws when the key is not registered, unless `{ optional: true }` is passed.
   */
  get<K extends keyof S, O extends GetOptions = {}>(
    key: K | TaggedKey<any, K>,
    options?: O,
  ): O extends { optional: true }
    ? ServiceType<S, K> | undefined
    : ServiceType<S, K>;

  /** `true` when a service is registered under `key` (here or in a parent). */
  has(key: ServiceKey, options?: HasOptions): boolean;

  /** Returns a function that resolves `key` when called. */
  createResolver<K extends keyof S>(
    key: K | TaggedKey<any, K>,
  ): () => ServiceType<S, K>;

  /** Resolves a function service and calls it with `args`. */
  call<K extends keyof S>(
    key: K | TaggedKey<any, K>,
    args: Parameters<Extract<ServiceType<S, K>, (...args: any[]) => any>>,
    thisArg?: unknown,
  ): ReturnType<Extract<ServiceType<S, K>, (...args: any[]) => any>>;

  /** Keys visible from this container, including its parents'. */
  readonly keys: readonly ServiceKey[];

  /** Keys registered in this container. */
  readonly ownKeys: readonly ServiceKey[];

  /** The parent container (read-only view), if any. */
  getParent(): ServiceProvider | undefined;

  /** Read-only metadata of the registration visible under `key`, or `undefined`. */
  getRegistration(key: ServiceKey): RegistrationInfo | undefined;
}

// ------------------------------------------------------------------------------------- namespaces

declare const namespaceBrand: unique symbol;

/**
 * Stands for a namespace in a service map. The map keeps each service of a namespace once, under
 * `Name.key`; `get('Name')` returns a {@link ServiceProvider} of those services (see {@link ServiceType}).
 * Keeping the provider out of the map keeps inferred types and emitted `.d.ts` files small.
 *
 * @example
 * ```ts
 * const app = new DIContainer().namespace('Billing', (b) => b.addInstance('currency', 'EUR'));
 *
 * type Services = ContainerServices<typeof app>; // { Billing: Namespace; 'Billing.currency': string }
 * app.get('Billing'); // ServiceProvider<{ currency: string }>
 * ```
 */
export interface Namespace {
  readonly [namespaceBrand]: 'sync';
}

/**
 * Stands for a namespace of an {@link AsyncDIContainer} in a service map: `get('Name')` resolves to an
 * {@link AsyncServiceProvider} of its services.
 *
 * @example
 * ```ts
 * const app = new AsyncDIContainer().namespace('Billing', (b) => b.addInstance('currency', 'EUR'));
 *
 * type Services = ContainerServices<typeof app>; // { Billing: AsyncNamespace; 'Billing.currency': string }
 * await app.get('Billing'); // AsyncServiceProvider<{ currency: string }>
 * ```
 */
export interface AsyncNamespace {
  readonly [namespaceBrand]: 'async';
}

/**
 * The services of namespace `N` in service map `S`, without the `N.` prefix. Nested namespaces keep
 * their inner prefix (`Read`, `Read.key`).
 *
 * @example
 * ```ts
 * type S = { Billing: Namespace; 'Billing.currency': string; db: Database };
 * type Billing = ServicesInNamespace<S, 'Billing'>; // { currency: string }
 * ```
 */
export type ServicesInNamespace<S, N extends ServiceKey> = {
  [K in keyof S as K extends `${N & string}.${infer R}` ? R : never]: S[K];
};

/**
 * What resolving `K` from service map `S` returns: the registered type, or for a namespace key a
 * provider of the namespace's services.
 *
 * @example
 * ```ts
 * type S = { Billing: Namespace; 'Billing.currency': string; db: Database };
 * type Db = ServiceType<S, 'db'>; // Database
 * type Billing = ServiceType<S, 'Billing'>; // ServiceProvider<{ currency: string }>
 * ```
 */
export type ServiceType<S, K extends keyof S> = [S[K]] extends [
  Namespace | AsyncNamespace,
]
  ? // `any` and `never` are assignable to the markers too; only a marker has exactly the brand key
    [keyof S[K]] extends [typeof namespaceBrand]
    ? [S[K]] extends [AsyncNamespace]
      ? AsyncServiceProvider<ServicesInNamespace<S, K>>
      : ServiceProvider<ServicesInNamespace<S, K>>
    : S[K]
  : S[K];

/**
 * Services added under a namespace: `Name` (a {@link Namespace}; `get('Name')` returns its provider)
 * and `Name.key` for each service.
 *
 * @example
 * ```ts
 * type Billing = NamespacedServices<'Billing', { currency: string }>;
 * // { Billing: Namespace } & { 'Billing.currency': string }
 * ```
 */
export type NamespacedServices<N extends string, T> = {
  [P in N]: Namespace;
} & {
  [K in keyof T as K extends string | number ? `${N}.${K}` : never]: T[K];
};

/**
 * The services a registry resolves: the ones it was given (`S`) and the ones it added (`A`).
 * A container is a registry that was given nothing, so its services are just `A`.
 *
 * @example
 * ```ts
 * type Billing = RegistryServices<{ db: Database }, { invoices: InvoiceRepository }>;
 * // { db: Database } & { invoices: InvoiceRepository }
 * ```
 */
export type RegistryServices<S, A> = [keyof S] extends [never] ? A : S & A;

/**
 * Read + register: what extension (module) functions and `namespace()` callbacks receive.
 * It cannot add middlewares, listen to events, fork or dispose; that is the composition root's job
 * (the {@link DIContainer} itself).
 *
 * `S` is the services the registry was given, `A` the services added through it; it resolves both
 * (`S & A`). Registrations grow only `A`, so `S` (usually the whole container) stays one type and
 * lookups into it are computed once per callback, which keeps long modules cheap to typecheck.
 *
 * @example A module declares only what it needs
 * ```ts
 * const addBilling = (c: ServiceRegistry<{ db: Database }>) =>
 *   c.addSingleton('invoices', InvoiceRepository, ['db']);
 *
 * app.extend(addBilling);
 * ```
 */
export interface ServiceRegistry<
  S extends object = {},
  A extends object = {},
> extends ServiceProvider<RegistryServices<S, A>> {
  /**
   * Registers a service created once and cached. `factory` is a function or a class; it receives the
   * dependencies in order.
   */
  addSingleton<
    K extends ServiceKey,
    F extends Factory<D, S, A, ExpectedService<K>>,
    D extends Dependency<S, A>[] = [],
    const R extends boolean = false,
  >(
    key: K,
    factory: F,
    dependencies?: [...D] | SingletonFactoryOptions<[...D], F, R>,
  ): ServiceRegistry<
    S,
    Registered<A, { [P in RegisteredKey<K>]: Produced<F> }, R>
  >;

  /** Registers a service created on every resolution. */
  addTransient<
    K extends ServiceKey,
    F extends Factory<D, S, A, ExpectedService<K>>,
    D extends Dependency<S, A>[] = [],
    const R extends boolean = false,
  >(
    key: K,
    factory: F,
    dependencies?: [...D] | RegistrationOptions<[...D], R>,
  ): ServiceRegistry<
    S,
    Registered<A, { [P in RegisteredKey<K>]: Produced<F> }, R>
  >;

  /** Registers an existing value. */
  addInstance<
    K extends ServiceKey,
    T extends ExpectedService<K>,
    const R extends boolean = false,
  >(
    key: K,
    value: T,
    options?: InstanceOptions<Awaited<T>, R>,
  ): ServiceRegistry<S, Registered<A, { [P in RegisteredKey<K>]: T }, R>>;

  /** Makes `key` resolve to the service registered under `target`. */
  addAlias<K extends ServiceKey, T extends AliasTarget<K, S & A>>(
    key: K,
    target: T,
  ): ServiceRegistry<
    S,
    A & { [P in RegisteredKey<K>]: ResolveDependency<T, S, A> }
  >;

  /**
   * Registers the services added by `extension` under `name.`: `name.key` for each of them, and `name`
   * for the namespace's provider. The extension receives a fork of this container.
   */
  namespace<
    const N extends string,
    NA extends object,
    Req extends object = S & A,
  >(
    name: N,
    extension: [S & A] extends [Req]
      ? (registry: ServiceRegistry<Req, {}>) => ServiceRegistry<any, NA>
      : {
          'injecute: extension requires services that are not registered': Exclude<
            keyof Req,
            keyof (S & A)
          >;
        },
  ): ServiceRegistry<
    S,
    A & { [K in keyof NamespacedServices<N, NA>]: NamespacedServices<N, NA>[K] }
  >;

  /** Applies a module function that registers services. */
  extend<EA extends object, Req extends object = S & A>(
    extension: [S & A] extends [Req]
      ? (registry: ServiceRegistry<Req, {}>) => ServiceRegistry<any, EA>
      : {
          'injecute: extension requires services that are not registered': Exclude<
            keyof Req,
            keyof (S & A)
          >;
        },
  ): ServiceRegistry<S, A & { [K in keyof EA]: EA[K] }>;

  /** Runs a function (or class) with resolved dependencies, without registering it. */
  injecute<D extends Dependency<S, A>[], R>(
    factory:
      | ((...args: ResolveDependencies<D, S, A>) => R)
      | (new (...args: ResolveDependencies<D, S, A>) => R),
    dependencies: [...D],
  ): R;

  /** Returns a function that runs `factory` with resolved dependencies each time it is called. */
  bind<D extends Dependency<S, A>[], R>(
    dependencies: [...D],
    factory:
      | ((...args: ResolveDependencies<D, S, A>) => R)
      | (new (...args: ResolveDependencies<D, S, A>) => R),
  ): () => R;
}

/** @deprecated Use {@link ServiceRegistry} (read + register) or {@link ServiceProvider} (read-only). */
export type IDIContainer<S extends object = {}> = ServiceRegistry<{}, S>;

// ------------------------------------------------------------------------------- async containers

/**
 * Read-only access to an {@link AsyncDIContainer}'s services. Like {@link ServiceProvider}, but
 * resolutions return promises of the (resolved) service types.
 *
 * @example
 * ```ts
 * function createHandler(services: AsyncServiceProvider<{ users: UserRepository }>) {
 *   return async (id: string) => (await services.get('users')).find(id);
 * }
 * createHandler(app); // an AsyncDIContainer with `users` and more
 * ```
 */
export interface AsyncServiceProvider<S extends object = {}> {
  /**
   * Resolves a service. Rejects when the key is not registered, unless `{ optional: true }` is passed.
   */
  get<K extends keyof S, O extends GetOptions = {}>(
    key: K | TaggedKey<any, K>,
    options?: O,
  ): Promise<
    O extends { optional: true }
      ? ServiceType<S, K> | undefined
      : ServiceType<S, K>
  >;

  /** `true` when a service is registered under `key` (here or in a parent). */
  has(key: ServiceKey, options?: HasOptions): boolean;

  /** Returns a function that resolves `key` when called. */
  createResolver<K extends keyof S>(
    key: K | TaggedKey<any, K>,
  ): () => Promise<ServiceType<S, K>>;

  /** Resolves a function service and calls it with `args`. */
  call<K extends keyof S>(
    key: K | TaggedKey<any, K>,
    args: Parameters<Extract<ServiceType<S, K>, (...args: any[]) => any>>,
    thisArg?: unknown,
  ): Promise<
    Awaited<ReturnType<Extract<ServiceType<S, K>, (...args: any[]) => any>>>
  >;

  /** Keys visible from this container, including its parents'. */
  readonly keys: readonly ServiceKey[];

  /** Keys registered in this container. */
  readonly ownKeys: readonly ServiceKey[];

  /** The parent container (read-only view), if any. */
  getParent(): AsyncServiceProvider | undefined;

  /** Read-only metadata of the registration visible under `key`, or `undefined`. */
  getRegistration(key: ServiceKey): RegistrationInfo | undefined;
}

/**
 * Services added under a namespace of an async container: `Name` (an {@link AsyncNamespace}) and
 * `Name.key` for each service.
 *
 * @example
 * ```ts
 * type Billing = AsyncNamespacedServices<'Billing', { currency: string }>;
 * // { Billing: AsyncNamespace } & { 'Billing.currency': string }
 * ```
 */
export type AsyncNamespacedServices<N extends string, T> = {
  [P in N]: AsyncNamespace;
} & {
  [K in keyof T as K extends string | number ? `${N}.${K}` : never]: T[K];
};

/**
 * Read + register for an {@link AsyncDIContainer}: what its modules and `namespace()` callbacks
 * receive. Factories receive resolved dependencies; a factory returning `Promise<T>` registers `T`.
 * Async modules work only with async containers.
 *
 * @example
 * ```ts
 * const addBilling = (c: AsyncServiceRegistry<{ db: Database }>) =>
 *   c.addSingleton('invoices', InvoiceRepository, ['db']);
 *
 * asyncApp.extend(addBilling);
 * ```
 */
export interface AsyncServiceRegistry<
  S extends object = {},
  A extends object = {},
> extends AsyncServiceProvider<RegistryServices<S, A>> {
  /**
   * Registers a service created once and cached. The factory receives resolved dependencies and may
   * return a promise; the service type is the resolved value.
   */
  addSingleton<
    K extends ServiceKey,
    F extends Factory<D, S, A, AsyncExpectedService<K>>,
    D extends Dependency<S, A>[] = [],
    const R extends boolean = false,
  >(
    key: K,
    factory: F,
    dependencies?: [...D] | SingletonFactoryOptions<[...D], F, R>,
  ): AsyncServiceRegistry<
    S,
    Registered<A, { [P in RegisteredKey<K>]: Awaited<Produced<F>> }, R>
  >;

  /** Registers a service created on every resolution. */
  addTransient<
    K extends ServiceKey,
    F extends Factory<D, S, A, AsyncExpectedService<K>>,
    D extends Dependency<S, A>[] = [],
    const R extends boolean = false,
  >(
    key: K,
    factory: F,
    dependencies?: [...D] | RegistrationOptions<[...D], R>,
  ): AsyncServiceRegistry<
    S,
    Registered<A, { [P in RegisteredKey<K>]: Awaited<Produced<F>> }, R>
  >;

  /** Registers an existing value (or a promise of it). */
  addInstance<
    K extends ServiceKey,
    T extends AsyncExpectedService<K>,
    const R extends boolean = false,
  >(
    key: K,
    value: T,
    options?: InstanceOptions<Awaited<T>, R>,
  ): AsyncServiceRegistry<
    S,
    Registered<A, { [P in RegisteredKey<K>]: Awaited<T> }, R>
  >;

  /** Makes `key` resolve to the service registered under `target`. */
  addAlias<K extends ServiceKey, T extends AliasTarget<K, S & A>>(
    key: K,
    target: T,
  ): AsyncServiceRegistry<
    S,
    A & { [P in RegisteredKey<K>]: ResolveDependency<T, S, A> }
  >;

  /**
   * Registers the services added by `extension` under `name.`: `name.key` for each of them, and `name`
   * for the namespace's provider. The extension receives a fork of this container.
   */
  namespace<
    const N extends string,
    NA extends object,
    Req extends object = S & A,
  >(
    name: N,
    extension: [S & A] extends [Req]
      ? (
          registry: AsyncServiceRegistry<Req, {}>,
        ) => AsyncServiceRegistry<any, NA>
      : {
          'injecute: extension requires services that are not registered': Exclude<
            keyof Req,
            keyof (S & A)
          >;
        },
  ): AsyncServiceRegistry<
    S,
    A & {
      [K in keyof AsyncNamespacedServices<N, NA>]: AsyncNamespacedServices<
        N,
        NA
      >[K];
    }
  >;

  /** Applies a module function that registers services. */
  extend<EA extends object, Req extends object = S & A>(
    extension: [S & A] extends [Req]
      ? (
          registry: AsyncServiceRegistry<Req, {}>,
        ) => AsyncServiceRegistry<any, EA>
      : {
          'injecute: extension requires services that are not registered': Exclude<
            keyof Req,
            keyof (S & A)
          >;
        },
  ): AsyncServiceRegistry<S, A & { [K in keyof EA]: EA[K] }>;

  /** Runs a function (or class) with resolved dependencies, without registering it. */
  injecute<D extends Dependency<S, A>[], R>(
    factory:
      | ((...args: ResolveDependencies<D, S, A>) => R)
      | (new (...args: ResolveDependencies<D, S, A>) => R),
    dependencies: [...D],
  ): Promise<Awaited<R>>;

  /** Returns a function that runs `factory` with resolved dependencies each time it is called. */
  bind<D extends Dependency<S, A>[], R>(
    dependencies: [...D],
    factory:
      | ((...args: ResolveDependencies<D, S, A>) => R)
      | (new (...args: ResolveDependencies<D, S, A>) => R),
  ): () => Promise<Awaited<R>>;
}

/**
 * Service map `S` plus the services in `T`. With `R` true (the registration passed `replace: true`),
 * `T`'s services replace the same keys of `S`, so replacing a service changes its type instead of
 * intersecting the old and the new one.
 *
 * @example
 * ```ts
 * type Added = Registered<{ port: string }, { host: string }, false>; // { port: string } & { host: string }
 * type Replaced = Registered<{ port: string; host: string }, { port: number }, true>;
 * // Omit<{ port: string; host: string }, 'port'> & { port: number }
 * ```
 */
export type Registered<S, T, R> = R extends true ? Omit<S, keyof T> & T : S & T;

// ------------------------------------------------------------------------------------ sealed containers

/** The methods that register services; a sealed container has none of them. */
type RegistrationMethod =
  | 'addSingleton'
  | 'addTransient'
  | 'addInstance'
  | 'addAlias'
  | 'namespace'
  | 'extend'
  | 'seal';

/** Owner methods that return the container itself (redeclared so they return the sealed type). */
type ChainedMethod =
  'use' | 'unuse' | 'addEventListener' | 'removeEventListener' | 'reset';

/**
 * A {@link DIContainer} after `seal()`: it resolves services, runs middlewares and events, resets and
 * disposes, but registers nothing. Its forks are regular, open containers.
 *
 * @example
 * ```ts
 * const app: SealedDIContainer<{ db: Database }> = new DIContainer().addSingleton('db', createDb).seal();
 * app.get('db');
 * app.fork().addInstance('requestId', id);
 * ```
 */
export interface SealedDIContainer<S extends object = {}> extends Omit<
  DIContainer<S>,
  RegistrationMethod | ChainedMethod
> {
  /** Adds a middleware around every resolution started from this container and its forks. */
  use(middleware: Middleware): this;
  /** Removes a middleware added with `use()`. */
  unuse(middleware: Middleware): this;
  /** Subscribes to container events. */
  addEventListener<E extends keyof ContainerEvents>(
    event: E,
    handler: (event: ContainerEvents[E]) => void,
  ): this;
  /** Removes a listener added with `addEventListener()`. */
  removeEventListener<E extends keyof ContainerEvents>(
    event: E,
    handler: (event: ContainerEvents[E]) => void,
  ): this;
  /** Clears cached instances (all, or `keys`), so the next resolution creates them again. */
  reset(options?: ResetOptions<S>): this;
}

/**
 * An {@link AsyncDIContainer} after `seal()`: like {@link SealedDIContainer}, with promises for resolutions.
 *
 * @example
 * ```ts
 * const app = new AsyncDIContainer().addSingleton('db', () => connect(url)).seal();
 * await app.get('db');
 * ```
 */
export interface SealedAsyncDIContainer<S extends object = {}> extends Omit<
  AsyncDIContainer<S>,
  RegistrationMethod | ChainedMethod
> {
  /** Adds a middleware around every resolution started from this container and its forks. */
  use(middleware: Middleware): this;
  /** Removes a middleware added with `use()`. */
  unuse(middleware: Middleware): this;
  /** Subscribes to container events. */
  addEventListener<E extends keyof ContainerEvents>(
    event: E,
    handler: (event: ContainerEvents[E]) => void,
  ): this;
  /** Removes a listener added with `addEventListener()`. */
  removeEventListener<E extends keyof ContainerEvents>(
    event: E,
    handler: (event: ContainerEvents[E]) => void,
  ): this;
  /** Clears cached instances (all, or `keys`), so the next resolution creates them again. */
  reset(options?: ResetOptions<S>): this;
}

// ---------------------------------------------------------------------------------------- helpers

/** The service map of a container, registry or provider type (sync or async). */
export type ContainerServices<C> =
  C extends DIContainer<infer S>
    ? S
    : C extends AsyncDIContainer<infer S>
      ? S
      : C extends SealedDIContainer<infer S>
        ? S
        : C extends SealedAsyncDIContainer<infer S>
          ? S
          : C extends AsyncServiceRegistry<infer S, infer A>
            ? RegistryServices<S, A>
            : C extends AsyncServiceProvider<infer S>
              ? S
              : C extends ServiceRegistry<infer S, infer A>
                ? RegistryServices<S, A>
                : C extends ServiceProvider<infer S>
                  ? S
                  : never;

/**
 * The services of namespace `N` of container type `C`, without the `N.` prefix.
 *
 * @example
 * ```ts
 * const app = new DIContainer().namespace('Billing', (b) => b.addInstance('currency', 'EUR'));
 * type Billing = NamespaceServices<typeof app, 'Billing'>; // { currency: string }
 * ```
 */
export type NamespaceServices<
  C,
  N extends keyof ContainerServices<C>,
> = ServicesInNamespace<ContainerServices<C>, N>;
