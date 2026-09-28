import type { DIContainer } from './container.ts';

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

/**
 * What a registration can depend on:
 * - a service key: the factory receives that service
 * - `optional(key)`: the service, or `undefined` when it is not registered
 * - a function: called on each resolution, the factory receives its result
 *
 * (`() => any` rather than `() => unknown` keeps typos in keys reported on the key itself.)
 */
export type Dependency<S> = keyof S | OptionalDependency | (() => any);

/** The value a single {@link Dependency} resolves to. */
export type ResolveDependency<D, S> =
  D extends OptionalDependency<infer K>
    ? K extends keyof S
      ? S[K] | undefined
      : undefined
    : D extends () => infer R
      ? R
      : D extends keyof S
        ? S[D]
        : never;

/** The factory arguments a dependency list resolves to. */
export type ResolveDependencies<D extends readonly unknown[], S> = {
  -readonly [I in keyof D]: ResolveDependency<D[I], S>;
};

/** @deprecated Renamed to {@link ResolveDependencies}. */
export type DependenciesToTypes<
  D extends readonly unknown[],
  S,
> = ResolveDependencies<D, S>;

// ------------------------------------------------------------------------------------- factories

/**
 * Creates a service from its resolved dependencies: a function, or a class (called with `new`).
 */
export type Factory<D extends readonly unknown[], S> =
  | ((...args: ResolveDependencies<D, S>) => unknown)
  | (new (...args: ResolveDependencies<D, S>) => unknown);

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
export interface RegistrationOptions<D> {
  /** Dependency keys, passed to the factory in the same order. */
  dependencies?: D;
  /** Replace an existing registration of this key in the same container. */
  replace?: boolean;
}

/** Options for {@link ServiceRegistry.addSingleton}. */
export interface SingletonOptions<D, T> extends RegistrationOptions<D> {
  /** How `dispose()` releases the instance. Default: auto-detect `[Symbol.asyncDispose]` / `[Symbol.dispose]`. */
  dispose?: DisposeOption<T>;
}

/** Options for {@link ServiceRegistry.addInstance}. */
export interface InstanceOptions<T> {
  /** Replace an existing registration of this key in the same container. */
  replace?: boolean;
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
    key: K,
    options?: O,
  ): O extends { optional: true } ? S[K] | undefined : S[K];

  /** `true` when a service is registered under `key` (here or in a parent). */
  has(key: ServiceKey, options?: HasOptions): boolean;

  /** Returns a function that resolves `key` when called. */
  createResolver<K extends keyof S>(key: K): () => S[K];

  /** Resolves a function service and calls it with `args`. */
  call<K extends keyof S>(
    key: K,
    args: Parameters<Extract<S[K], (...args: any[]) => any>>,
    thisArg?: unknown,
  ): ReturnType<Extract<S[K], (...args: any[]) => any>>;

  /** Keys visible from this container, including its parents'. */
  readonly keys: readonly ServiceKey[];

  /** Keys registered in this container. */
  readonly ownKeys: readonly ServiceKey[];

  /** The parent container (read-only view), if any. */
  getParent(): ServiceProvider | undefined;

  /** Read-only metadata of the registration visible under `key`, or `undefined`. */
  getRegistration(key: ServiceKey): RegistrationInfo | undefined;
}

/** Services added under a namespace: `Name` (the namespace's provider) and `Name.key` for each service. */
export type NamespacedServices<N extends string, T> = {
  [P in N]: ServiceProvider<T & {}>;
} & {
  [K in keyof T as K extends string | number ? `${N}.${K}` : never]: T[K];
};

/**
 * Read + register: what extension (module) functions and `namespace()` callbacks receive.
 * It cannot add middlewares, listen to events, fork or dispose; that is the composition root's job
 * (the {@link DIContainer} itself).
 *
 * `A` tracks the services added through this registry; it types namespace entries.
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
> extends ServiceProvider<S> {
  /**
   * Registers a service created once and cached. `factory` is a function or a class; it receives the
   * dependencies in order.
   */
  addSingleton<
    K extends ServiceKey,
    F extends Factory<D, S>,
    D extends Dependency<S>[] = [],
  >(
    key: K,
    factory: F,
    dependencies?: [...D] | SingletonOptions<[...D], Awaited<Produced<F>>>,
  ): ServiceRegistry<
    S & { [P in K]: Produced<F> },
    A & { [P in K]: Produced<F> }
  >;

  /** Registers a service created on every resolution. */
  addTransient<
    K extends ServiceKey,
    F extends Factory<D, S>,
    D extends Dependency<S>[] = [],
  >(
    key: K,
    factory: F,
    dependencies?: [...D] | RegistrationOptions<[...D]>,
  ): ServiceRegistry<
    S & { [P in K]: Produced<F> },
    A & { [P in K]: Produced<F> }
  >;

  /** Registers an existing value. */
  addInstance<K extends ServiceKey, T>(
    key: K,
    value: T,
    options?: InstanceOptions<Awaited<T>>,
  ): ServiceRegistry<S & { [P in K]: T }, A & { [P in K]: T }>;

  /** Makes `key` resolve to the service registered under `target`. */
  addAlias<K extends ServiceKey, T extends keyof S>(
    key: K,
    target: T,
  ): ServiceRegistry<S & { [P in K]: S[T] }, A & { [P in K]: S[T] }>;

  /**
   * Registers the services added by `extension` under `name.`: `name.key` for each of them, and `name`
   * for the namespace's provider. The extension receives a fork of this container.
   */
  namespace<const N extends string, NA extends object, Req extends object = S>(
    name: N,
    extension: [S] extends [Req]
      ? (
          registry: ServiceRegistry<Req, {}>,
        ) => ServiceRegistry<any, NA> | DIContainer<NA>
      : {
          'injecute: extension requires services that are not registered': Exclude<
            keyof Req,
            keyof S
          >;
        },
  ): ServiceRegistry<
    S & NamespacedServices<N, NA>,
    A & NamespacedServices<N, NA>
  >;

  /** Applies a module function that registers services. */
  extend<EA extends object, Req extends object = S>(
    extension: [S] extends [Req]
      ? (
          registry: ServiceRegistry<Req, {}>,
        ) => ServiceRegistry<any, EA> | DIContainer<EA>
      : {
          'injecute: extension requires services that are not registered': Exclude<
            keyof Req,
            keyof S
          >;
        },
  ): ServiceRegistry<S & EA, A & EA>;

  /** Runs a function (or class) with resolved dependencies, without registering it. */
  injecute<D extends Dependency<S>[], R>(
    factory:
      | ((...args: ResolveDependencies<D, S>) => R)
      | (new (...args: ResolveDependencies<D, S>) => R),
    dependencies: [...D],
  ): R;

  /** Returns a function that runs `factory` with resolved dependencies each time it is called. */
  bind<D extends Dependency<S>[], R>(
    dependencies: [...D],
    factory:
      | ((...args: ResolveDependencies<D, S>) => R)
      | (new (...args: ResolveDependencies<D, S>) => R),
  ): () => R;
}

/** @deprecated Use {@link ServiceRegistry} (read + register) or {@link ServiceProvider} (read-only). */
export type IDIContainer<S extends object = {}> = ServiceRegistry<S, S>;

/** The service map of a container, registry or provider type. */
export type ContainerServices<C> =
  C extends DIContainer<infer S>
    ? S
    : C extends ServiceRegistry<infer S, any>
      ? S
      : C extends ServiceProvider<infer S>
        ? S
        : never;

/** The services of namespace `N` of container type `C`. */
export type NamespaceServices<C, N extends keyof ContainerServices<C>> =
  ContainerServices<C>[N] extends ServiceProvider<infer S> ? S : never;
