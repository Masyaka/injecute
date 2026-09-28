import { optionalKey } from './dependencies.ts';
import {
  CircularDependencyError,
  InjecuteError,
  isClassCallError,
  looksLikeConstructor,
  suggestKeys,
} from './errors.ts';
import {
  callableOf,
  isClass,
  isThenable,
  SET_CACHE_INSTANCE,
} from './internal.ts';
import type {
  ContainerEvents,
  Dependency,
  DependencyInfo,
  DisposeOption,
  Factory,
  ForkOptions,
  GetOptions,
  HasOptions,
  InstanceOptions,
  Middleware,
  MiddlewareContext,
  NamespacedServices,
  Produced,
  RegistrationInfo,
  RegistrationKind,
  RegistrationOptions,
  ResetOptions,
  ResolveDependencies,
  ServiceKey,
  ServiceProvider,
  ServiceRegistry,
  SingletonOptions,
} from './types.ts';

/** Internal: a dependency after normalization. */
type InternalDependency =
  | { readonly type: 'key'; readonly key: ServiceKey }
  | { readonly type: 'optional'; readonly key: ServiceKey }
  | { readonly type: 'previous'; readonly key: ServiceKey }
  | { readonly type: 'function'; readonly fn: () => unknown };

/** Internal: a registration is plain data; the executing container owns produced instances. */
interface Registration {
  readonly key: ServiceKey;
  readonly kind: RegistrationKind;
  readonly owner: DIContainer<any>;
  readonly dependencies: readonly InternalDependency[];
  readonly factory?: (...args: any[]) => unknown;
  /** the factory is a class: call it with `new` */
  readonly construct?: boolean;
  readonly value?: unknown;
  /** alias target, namespace-entry key, or delegate target */
  readonly target?: ServiceKey;
  /** namespace-entry: the namespace container; namespace: the container itself; delegate: target container */
  readonly container?: DIContainer<any>;
  readonly namespace?: string;
  /** namespace: the callback, re-applied lazily inside isolated forks */
  readonly extension?: (c: any) => unknown;
  /** the registration this one replaced in the same container */
  readonly previous?: Registration;
  readonly dispose?: DisposeOption<any>;
}

const NOT_FOUND: unique symbol = Symbol('injecute.notFound');

// Well-known symbols with the same fallback TypeScript's `using` helper uses, for runtimes without them.
const asyncDispose: typeof Symbol.asyncDispose = (Symbol.asyncDispose ??
  Symbol.for('Symbol.asyncDispose')) as typeof Symbol.asyncDispose;
const syncDispose: typeof Symbol.dispose = (Symbol.dispose ??
  Symbol.for('Symbol.dispose')) as typeof Symbol.dispose;

/** An instance this container created (or was asked to own), in creation order. */
interface Owned {
  readonly seq: number;
  readonly reg: Registration;
  readonly value: unknown;
}

const isKey = (a: unknown): a is string | number | symbol =>
  typeof a === 'string' || typeof a === 'number' || typeof a === 'symbol';

const isLinkableKey = (k: ServiceKey): k is string | number =>
  typeof k === 'string' || typeof k === 'number';

const namespaceKey = (namespace: string, key: string | number) =>
  `${namespace}.${key}`;

const describeKey = (k: ServiceKey) => String(k);

type Listeners = {
  [E in keyof ContainerEvents]: Set<(e: ContainerEvents[E]) => void>;
};

/**
 * A dependency injection container: registers services with explicit dependency keys and resolves them
 * with full types. The container is the composition root: it can also add middlewares, listen to
 * events, fork scopes and dispose what it created. Hand narrower views to the rest of the code:
 * {@link ServiceRegistry} to modules, {@link ServiceProvider} to consumers.
 *
 * @example
 * ```ts
 * import { DIContainer } from 'injecute';
 *
 * class UserRepository {
 *   constructor(readonly dbUrl: string) {}
 * }
 *
 * const app = new DIContainer()
 *   .addInstance('dbUrl', 'postgres://localhost/app')
 *   .addSingleton('users', UserRepository, ['dbUrl']);
 *
 * app.get('users'); // UserRepository
 * ```
 */
export class DIContainer<S extends object = {}> implements ServiceRegistry<
  S,
  S
> {
  #parent: DIContainer<any> | undefined;
  readonly #registrations = new Map<ServiceKey, Registration>();
  /** instances produced (and owned) by this container, keyed by registration */
  readonly #instances = new Map<Registration, unknown>();
  /** values set with setCacheInstance(); cleared by reset() */
  readonly #overrides = new Map<ServiceKey, unknown>();
  readonly #middlewares: Middleware[] = [];
  #inheritMiddlewares = true;
  /** Isolated forks run (and own) every factory they resolve, including parent-registered ones. */
  #isolated = false;
  /** Owned instances, in creation order, including ones retired by replace()/reset(). */
  #owned: Owned[] = [];
  /** Creation order across all containers, so dispose() can run dependents first. */
  static #sequence = 0;
  #disposed = false;
  #disposing: Promise<void> | undefined;
  /** Namespace containers re-created inside this isolated fork, keyed by the namespace registration. */
  readonly #isolatedNamespaces = new Map<Registration, DIContainer<any>>();
  #middlewareCache: { epoch: number; list: readonly Middleware[] } | undefined;
  /** Bumped by every use()/unuse() anywhere, so cached effective chains are rebuilt. */
  static #middlewareEpoch = 0;
  readonly #listeners: Listeners = {
    add: new Set(),
    replace: new Set(),
    reset: new Set(),
    get: new Set(),
    produce: new Set(),
    dispose: new Set(),
  };

  /**
   * @internal Creates the container used by {@link fork}. Subclasses keep their type in forks.
   */
  protected createChild(): DIContainer<any> {
    const Ctor = this.constructor as new () => DIContainer<any>;
    const child = new Ctor();
    child.#parent = this;
    return child;
  }

  /**
   * @internal Calls a factory. Subclasses (the async container) override it to change how factories run.
   */
  protected invokeFactory(
    factory: (...args: any[]) => unknown,
    args: unknown[],
  ): unknown {
    return factory(...args);
  }

  // ------------------------------------------------------------------------------ ServiceProvider

  /**
   * Resolves a service: returns the cached singleton, creates it, or creates a new transient.
   * Looks in parent containers when the key is not registered here. Throws when nothing is
   * registered under `key`, unless `{ optional: true }` is passed.
   *
   * @throws {InjecuteError} `INJECUTE_NOT_REGISTERED` (with "did you mean" suggestions),
   * `INJECUTE_RESOLUTION_FAILED` when a factory throws (the original error is `cause`),
   * `INJECUTE_CLASS_NOT_CONSTRUCTED`, `INJECUTE_DISPOSED`.
   *
   * @example
   * ```ts
   * const users = app.get('users');
   * const cache = app.get('cache', { optional: true }); // Cache | undefined
   * ```
   */
  get<K extends keyof S, O extends GetOptions = {}>(
    key: K,
    options?: O,
  ): O extends { optional: true } ? S[K] | undefined : S[K] {
    this.#assertNotDisposed();
    return this.#get(key, options?.optional ?? false, []) as any;
  }

  /** `true` when a service is registered under `key`, here or (unless `local: true`) in a parent. */
  has(key: ServiceKey, options?: HasOptions): boolean {
    if (this.#registrations.has(key) || this.#overrides.has(key)) return true;
    return options?.local ? false : !!this.#parent?.has(key);
  }

  /** Returns a function that resolves `key` when called. */
  createResolver<K extends keyof S>(key: K): () => S[K] {
    return () => this.get(key);
  }

  /**
   * Resolves a function service and calls it.
   *
   * @example
   * ```ts
   * app.addInstance('greet', (name: string) => `Hello ${name}`);
   * app.call('greet', ['Ada']); // "Hello Ada"
   * ```
   */
  call<K extends keyof S>(
    key: K,
    args: Parameters<Extract<S[K], (...args: any[]) => any>>,
    thisArg: unknown = undefined,
  ): ReturnType<Extract<S[K], (...args: any[]) => any>> {
    const value = this.get(key);
    if (typeof value !== 'function') {
      throw new InjecuteError(
        'INJECUTE_NOT_A_FUNCTION',
        `Service "${describeKey(key)}" is not a function, so it cannot be called.`,
      );
    }
    return value.apply(thisArg, args);
  }

  /** Keys visible from this container, including its parents' (each once). */
  get keys(): readonly ServiceKey[] {
    const keys = new Set<ServiceKey>(this.#registrations.keys());
    for (const k of this.#parent?.keys ?? []) keys.add(k);
    return [...keys];
  }

  /** Keys registered in this container. */
  get ownKeys(): readonly ServiceKey[] {
    return [...this.#registrations.keys()];
  }

  /** The parent container as a read-only view, if any. */
  getParent(): ServiceProvider | undefined {
    return this.#parent ? this.#parent.#view() : undefined;
  }

  /** Read-only metadata of the registration visible under `key`, or `undefined`. */
  getRegistration(key: ServiceKey): RegistrationInfo | undefined {
    let depth = 0;
    let current: DIContainer<any> | undefined = this;
    while (current) {
      const reg = current.#registrations.get(key);
      if (reg) return toInfo(reg, depth);
      current = current.#parent;
      depth++;
    }
    return undefined;
  }

  // ------------------------------------------------------------------------------ ServiceRegistry

  /**
   * Registers a service that is created once, on first use, and then cached.
   *
   * `factory` is a function or a class. It receives the resolved `dependencies` in order; a class is
   * called with `new`. A dependency on `key` itself receives the previous definition (decoration).
   *
   * A factory may return a promise: the promise is cached, a rejected one is dropped (the next
   * resolution tries again), and `dispose()` releases the resolved value.
   *
   * @remarks Classes compiled to ES5 and bound classes cannot be detected; register them with
   * {@link construct}.
   * @throws {InjecuteError} `INJECUTE_ALREADY_REGISTERED` when `key` is registered in this container
   * (pass `replace: true`), `INJECUTE_CIRCULAR_DEPENDENCY` when the dependencies form a cycle.
   *
   * @example
   * ```ts
   * app
   *   .addSingleton('db', () => createPool(process.env.DATABASE_URL))
   *   .addSingleton('cache', async () => connectRedis()) // Promise<Redis>, disposed once resolved
   *   .addSingleton('users', UserRepository, ['db'])
   *   .addSingleton('mailer', createMailer, { dependencies: ['config'], dispose: (m) => m.close() });
   * ```
   */
  addSingleton<
    K extends ServiceKey,
    F extends Factory<D, S>,
    D extends Dependency<S>[] = [],
  >(
    key: K,
    factory: F,
    dependencies?: [...D] | SingletonOptions<[...D], Awaited<Produced<F>>>,
  ): DIContainer<S & { [P in K]: Produced<F> }> {
    this.#addFactory('singleton', key, factory, dependencies);
    return this as any;
  }

  /**
   * Registers a service that is created again on every resolution. The container does not keep (or
   * dispose) transient instances.
   *
   * @remarks Classes compiled to ES5 and bound classes cannot be detected; register them with
   * {@link construct}.
   * @throws {InjecuteError} `INJECUTE_ALREADY_REGISTERED`, `INJECUTE_CIRCULAR_DEPENDENCY`.
   *
   * @example
   * ```ts
   * app.addTransient('requestId', () => crypto.randomUUID());
   * ```
   */
  addTransient<
    K extends ServiceKey,
    F extends Factory<D, S>,
    D extends Dependency<S>[] = [],
  >(
    key: K,
    factory: F,
    dependencies?: [...D] | RegistrationOptions<[...D]>,
  ): DIContainer<S & { [P in K]: Produced<F> }> {
    this.#addFactory('transient', key, factory, dependencies);
    return this as any;
  }

  /**
   * Registers an existing value. The container does not dispose it unless `dispose` is set.
   *
   * @example
   * ```ts
   * app.addInstance('config', loadConfig());
   * ```
   */
  addInstance<K extends ServiceKey, T>(
    key: K,
    value: T,
    options?: InstanceOptions<Awaited<T>>,
  ): DIContainer<S & { [P in K]: T }> {
    const dispose = options?.dispose ?? false;
    this.#register(
      { key, kind: 'instance', owner: this, dependencies: [], value, dispose },
      !!options?.replace,
    );
    if (dispose !== false) this.#own(this.#registrations.get(key)!, value);
    return this as any;
  }

  /**
   * Makes `key` resolve to the service registered under `target`.
   *
   * @example
   * ```ts
   * app.addAlias('logger', config.production ? 'jsonLogger' : 'prettyLogger');
   * ```
   */
  addAlias<K extends ServiceKey, T extends keyof S>(
    key: K,
    target: T,
  ): DIContainer<S & { [P in K]: S[T] }> {
    this.#register(
      {
        key,
        kind: 'alias',
        owner: this,
        target,
        dependencies: [{ type: 'key', key: target }],
      },
      false,
    );
    return this as any;
  }

  /**
   * Registers the services added by `extension` under a prefix: `name.key` for each of them, and
   * `name` for a read-only provider of the namespace. The extension receives a fork of this container,
   * so it can use every service registered here; its own registrations stay in the namespace.
   *
   * @example
   * ```ts
   * app.namespace('Billing', (billing) =>
   *   billing.addSingleton('invoices', InvoiceRepository, ['db']),
   * );
   * app.get('Billing.invoices');
   * ```
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
  ): DIContainer<S & NamespacedServices<N, NA>> {
    if (this.has(name)) {
      throw new InjecuteError(
        'INJECUTE_NAMESPACE_CONFLICT',
        `Namespace "${name}" cannot be added: the key is already in use.`,
      );
    }
    const run = extension as unknown as (registry: unknown) => unknown;
    const result = run(this.fork());
    if (result === this) {
      throw new InjecuteError(
        'INJECUTE_NAMESPACE_RESULT',
        `Namespace "${name}" callback returned the parent container itself.`,
      );
    }
    if (!(result instanceof DIContainer)) {
      throw new InjecuteError(
        'INJECUTE_NAMESPACE_RESULT',
        `Namespace "${name}" callback did not return a container.`,
      );
    }
    this.#adoptNamespace(name, result, run);
    return this as any;
  }

  /**
   * Applies a module: a function that registers services and returns the registry it was given (or a
   * fork of it). A module can declare only the services it needs; `extend` checks that they exist.
   *
   * @example
   * ```ts
   * const addBilling = (c: ServiceRegistry<{ db: Database }>) =>
   *   c.addSingleton('invoices', InvoiceRepository, ['db']);
   *
   * const app = new DIContainer().addSingleton('db', createDb).extend(addBilling);
   * ```
   */
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
  ): DIContainer<S & EA> {
    const run = extension as unknown as (registry: unknown) => unknown;
    const result = run.call(this, this);
    let current: unknown = result;
    while (current instanceof DIContainer) {
      if (current === this) return result as any;
      current = current.#parent;
    }
    throw new InjecuteError(
      'INJECUTE_EXTENSION_RESULT',
      'The extension returned a container that is not the same container or its child.',
    );
  }

  /**
   * Runs a function (or constructs a class) with resolved dependencies, without registering it.
   *
   * @example
   * ```ts
   * const handler = app.injecute((users, logger) => createHandler(users, logger), ['users', 'logger']);
   * ```
   */
  injecute<D extends Dependency<S>[], R>(
    factory:
      | ((...args: ResolveDependencies<D, S>) => R)
      | (new (...args: ResolveDependencies<D, S>) => R),
    dependencies: [...D],
  ): R {
    const deps = normalizeDependencies(dependencies, undefined);
    const args = deps.map((d) => this.#resolveDependency(d, undefined, []));
    return this.#invoke(callableOf(factory), args, factory, []) as R;
  }

  /**
   * Returns a function that runs `factory` with freshly resolved dependencies on every call.
   *
   * @example
   * ```ts
   * const sendReport = app.bind(['mailer', 'reports'], (mailer, reports) => mailer.send(reports.weekly()));
   * sendReport();
   * ```
   */
  bind<D extends Dependency<S>[], R>(
    dependencies: [...D],
    factory:
      | ((...args: ResolveDependencies<D, S>) => R)
      | (new (...args: ResolveDependencies<D, S>) => R),
  ): () => R {
    return () => this.injecute(factory, dependencies);
  }

  // ---------------------------------------------------------------------- owner: configure, lifecycle

  /**
   * Adds a middleware around every resolution started from this container and its forks.
   *
   * A middleware receives the key, a `next` function that continues the resolution (optionally with
   * another key) and a context with the resolution path. The last added middleware runs first.
   * Middlewares added to a parent later still apply to existing forks.
   *
   * @example
   * ```ts
   * app.use((key, next, { depth }) => {
   *   const start = performance.now();
   *   const value = next();
   *   console.debug(`${'  '.repeat(depth)}${String(key)}: ${performance.now() - start}ms`);
   *   return value;
   * });
   * ```
   */
  use(middleware: Middleware): this {
    this.#middlewares.push(middleware);
    DIContainer.#middlewareEpoch++;
    return this;
  }

  /** Removes a middleware added with {@link use}. */
  unuse(middleware: Middleware): this {
    const index = this.#middlewares.lastIndexOf(middleware);
    if (index !== -1) {
      this.#middlewares.splice(index, 1);
      DIContainer.#middlewareEpoch++;
    }
    return this;
  }

  /**
   * Subscribes to container events: `add`, `replace`, `reset`, `get`, `produce`, `dispose`.
   *
   * @example
   * ```ts
   * app.addEventListener('produce', ({ key }) => console.debug(`created ${String(key)}`));
   * ```
   */
  addEventListener<E extends keyof ContainerEvents>(
    event: E,
    handler: (event: ContainerEvents[E]) => void,
  ): this {
    if (!(event in this.#listeners)) throw this.#eventNotSupported(event);
    this.#listeners[event].add(handler);
    return this;
  }

  /** Removes a listener added with {@link addEventListener}. */
  removeEventListener<E extends keyof ContainerEvents>(
    event: E,
    handler: (event: ContainerEvents[E]) => void,
  ): this {
    if (!(event in this.#listeners)) throw this.#eventNotSupported(event);
    this.#listeners[event].delete(handler);
    return this;
  }

  /**
   * Creates a child container. The child sees every service of this container (and later additions to
   * it); services added to the child stay in the child.
   *
   * - By default a service registered in this container runs **here** and is shared by all forks,
   *   so overriding one of its dependencies in a fork does not affect it.
   * - With `isolated: true` the fork runs and caches **every** service it resolves, including ones
   *   registered here. Overrides in the fork then reach the whole graph, and nothing leaks back.
   *   Use it for tests and per-tenant variants.
   *
   * Services registered here can't depend on what a fork adds. Before forking per request, consider
   * the alternatives in the "Per-request state" guide: an argument, a factory with `using`, a context
   * accessor for request data (trace id, tenant, user), or one instance per context. A fork per request
   * fits a group of services that share per-request instances and depend on this container's services.
   *
   * @example
   * ```ts
   * await using requestScope = app.fork().addSingleton('tx', (db) => db.begin(), ['db']);
   *
   * const testContainer = app.fork({ isolated: true }).addInstance('db', fakeDb, { replace: true });
   * testContainer.get('users'); // built with fakeDb; app is untouched
   * ```
   */
  fork(options?: ForkOptions): DIContainer<S> {
    this.#assertNotDisposed();
    const child = this.createChild();
    child.#inheritMiddlewares = options?.middlewares ?? true;
    child.#isolated = options?.isolated ?? false;
    return child as DIContainer<S>;
  }

  /**
   * Clears cached instances (all, or `keys`), so the next resolution creates them again. Instances
   * are not disposed here; `dispose()` still releases them later.
   */
  reset(options: ResetOptions<S> = {}): this {
    const keys = options.keys ? new Set<ServiceKey>(options.keys) : undefined;
    for (const reg of [...this.#instances.keys()]) {
      if (!keys || keys.has(reg.key)) this.#instances.delete(reg);
    }
    for (const k of [...this.#overrides.keys()]) {
      if (!keys || keys.has(k)) this.#overrides.delete(k);
    }
    for (const reg of this.#registrations.values()) {
      if (reg.kind === 'namespace' && reg.container)
        reg.container.#resetChain(this);
    }
    if (options.resetParent) this.#parent?.reset(options as ResetOptions<any>);
    this.#emit('reset', {
      resetParent: options.resetParent || false,
      keys: options.keys,
      container: this.#view(),
    });
    return this;
  }

  /**
   * Disposes every instance this container owns, dependents first (reverse creation order), then marks
   * the container as disposed: later `get()` and registrations throw.
   *
   * Owned instances are the singletons this container created, and `addInstance` values registered
   * with `dispose`. Each is disposed with its registration's `dispose` function, or with
   * `[Symbol.asyncDispose]` / `[Symbol.dispose]` when it has one. Namespace containers are disposed
   * too; forks are not (dispose each fork you create, e.g. with `await using`).
   *
   * Calling it again returns the same promise. If some disposers fail, the others still run and the
   * promise rejects with an `AggregateError`.
   *
   * @example
   * ```ts
   * await using scope = app.fork().addSingleton('tx', (db) => db.begin(), ['db']);
   * // ... scope and its singletons (the transaction) are disposed at the end of the block
   * ```
   */
  dispose(): Promise<void> {
    this.#disposing ??= this.#runDispose();
    return this.#disposing;
  }

  /** Same as {@link dispose}; enables `await using container = …`. */
  [asyncDispose](): Promise<void> {
    return this.dispose();
  }

  /** @internal Used by setCacheInstance(). */
  [SET_CACHE_INSTANCE](key: ServiceKey, value: unknown): void {
    this.#overrides.set(key, value);
  }

  // ---------------------------------------------------------------- internals

  /**
   * Runs a factory. Errors that are not InjecuteErrors are wrapped with the resolution path (the
   * original is `cause`); a class called without `new` gets a CLASS_NOT_CONSTRUCTED hint. A returned
   * promise that rejects is wrapped the same way.
   */
  #invoke(
    factory: (...args: any[]) => unknown,
    args: unknown[],
    original: unknown,
    path: readonly ServiceKey[],
  ): unknown {
    const name = describeKey(
      path.at(-1) ?? ((original as { name?: string })?.name || 'factory'),
    );
    let value: unknown;
    try {
      value = this.invokeFactory(factory, args);
    } catch (error) {
      throw factoryError(error, name, original, path);
    }
    if (isThenable(value)) {
      return Promise.resolve(value).then(undefined, (error: unknown) => {
        throw factoryError(error, name, original, path);
      });
    }
    if (
      value === undefined &&
      !isClass(original) &&
      looksLikeConstructor(original)
    ) {
      throw classNotConstructed(name, original, path, undefined);
    }
    return value;
  }

  #notRegistered(key: ServiceKey, path: readonly ServiceKey[]): InjecuteError {
    const suggestions = suggestKeys(key, this.keys);
    let levels = 0;
    for (
      let level: DIContainer<any> | undefined = this;
      level;
      level = level.#parent
    )
      levels++;
    const searched =
      levels === 1
        ? 'this container'
        : `this container and ${levels - 1} parent(s)`;
    return new InjecuteError(
      'INJECUTE_NOT_REGISTERED',
      `No service registered for "${describeKey(key)}" (searched ${searched}).` +
        (suggestions.length > 0
          ? ` Did you mean ${suggestions.map((s) => `"${s}"`).join(', ')}?`
          : ''),
      { path },
    );
  }

  /** This container as the read-only view handed to middlewares and event listeners. */
  #view(): ServiceProvider<any> {
    return this as unknown as ServiceProvider<any>;
  }

  /** Ancestors' middlewares (root first) followed by this container's own, cached until use()/unuse(). */
  #effectiveMiddlewares(): readonly Middleware[] {
    const epoch = DIContainer.#middlewareEpoch;
    if (this.#middlewareCache?.epoch === epoch)
      return this.#middlewareCache.list;
    const inherited =
      this.#inheritMiddlewares && this.#parent
        ? this.#parent.#effectiveMiddlewares()
        : [];
    const list =
      inherited.length === 0
        ? this.#middlewares.slice()
        : [...inherited, ...this.#middlewares];
    this.#middlewareCache = { epoch, list };
    return list;
  }

  #own(reg: Registration, value: unknown) {
    this.#owned.push({ seq: DIContainer.#sequence++, reg, value });
  }

  /** A singleton promise that rejects is forgotten, so the next resolution creates it again. */
  #evictOnRejection(reg: Registration, promise: PromiseLike<unknown>) {
    promise.then(undefined, () => {
      if (this.#instances.get(reg) === promise) this.#instances.delete(reg);
      this.#owned = this.#owned.filter((o) => o.value !== promise);
    });
  }

  #assertNotDisposed() {
    if (this.#disposed) {
      throw new InjecuteError(
        'INJECUTE_DISPOSED',
        'This container is disposed.',
      );
    }
  }

  /** This container plus the namespace containers it owns (and theirs), up to this container. */
  #ownedContainers(): DIContainer<any>[] {
    const result: DIContainer<any>[] = [this];
    const addChain = (container: DIContainer<any>) => {
      for (
        let level: DIContainer<any> | undefined = container;
        level && level !== this && !result.includes(level);
        level = level.#parent
      ) {
        result.push(...level.#ownedContainers());
      }
    };
    for (const reg of this.#registrations.values()) {
      if (reg.kind === 'namespace' && reg.container) addChain(reg.container);
    }
    for (const container of this.#isolatedNamespaces.values())
      addChain(container);
    return result;
  }

  async #runDispose(): Promise<void> {
    const containers = this.#ownedContainers();
    for (const container of containers) container.#disposed = true;
    const owned = containers
      .flatMap((container) => container.#owned)
      .sort((a, b) => b.seq - a.seq);
    const done = new Set<unknown>();
    const errors: unknown[] = [];
    for (const { reg, value } of owned) {
      let instance: unknown;
      try {
        instance = await value;
      } catch {
        continue; // creation failed: nothing to release
      }
      if (done.has(instance)) continue;
      done.add(instance);
      try {
        await disposeValue(instance, reg.dispose);
      } catch (error) {
        errors.push(error);
      }
    }
    for (const container of containers) {
      container.#owned = [];
      container.#instances.clear();
    }
    this.#emit('dispose', { container: this.#view() });
    if (errors.length > 0) {
      throw new InjecuteError(
        'INJECUTE_DISPOSE_FAILED',
        `Failed to dispose ${errors.length} service(s).`,
        { cause: new AggregateError(errors, 'Dispose failures') },
      );
    }
  }

  #eventNotSupported(e: string) {
    const supported = Object.keys(this.#listeners)
      .map((k) => `"${k}"`)
      .join(', ');
    return new InjecuteError(
      'INJECUTE_UNKNOWN_EVENT',
      `Event "${e}" is not supported. Supported: ${supported}.`,
    );
  }

  #emit<E extends keyof ContainerEvents>(
    event: E,
    payload: ContainerEvents[E],
  ) {
    const handlers = this.#listeners[event] as Set<
      (e: ContainerEvents[E]) => void
    >;
    if (handlers.size === 0) return;
    for (const handler of handlers) handler(payload);
  }

  #addFactory(
    kind: 'singleton' | 'transient',
    key: ServiceKey,
    factory: unknown,
    options:
      | {
          replace?: boolean;
          dependencies?: unknown[];
          dispose?: DisposeOption<any>;
        }
      | unknown[]
      | undefined,
  ) {
    if (typeof factory !== 'function') {
      throw new InjecuteError(
        'INJECUTE_INVALID_FACTORY',
        `The factory for "${describeKey(key)}" is not a function or class (got ${typeof factory}).`,
      );
    }
    const isArray = Array.isArray(options);
    const replace = !isArray && !!options?.replace;
    const dependencies = (isArray ? options : options?.dependencies) ?? [];
    const dispose = isArray ? undefined : options?.dispose;
    if (kind === 'transient' && dispose !== undefined && dispose !== false) {
      throw new InjecuteError(
        'INJECUTE_INVALID_OPTION',
        `"dispose" is not supported for transient "${describeKey(key)}": the container does not keep transient instances.`,
      );
    }
    this.#register(
      {
        key,
        kind,
        owner: this,
        factory: factory as (...args: any[]) => unknown,
        construct: isClass(factory),
        dependencies: normalizeDependencies(dependencies, key),
        dispose,
      },
      replace,
    );
  }

  #register(reg: Registration, replace: boolean) {
    this.#assertNotDisposed();
    const key = reg.key;
    const existing = this.#registrations.get(key);
    if (existing && !replace) {
      throw new InjecuteError(
        'INJECUTE_ALREADY_REGISTERED',
        `"${describeKey(key)}" is already registered in this container.`,
      );
    }
    const usesPrevious = reg.dependencies.some((d) => d.type === 'previous');
    if (usesPrevious && !existing && !this.#parent?.has(key)) {
      throw new InjecuteError(
        'INJECUTE_NO_PREVIOUS_DEFINITION',
        `"${describeKey(key)}" depends on itself, but no previous definition of "${describeKey(key)}" is registered.`,
      );
    }
    this.#assertNoCycle(reg);
    const stored: Registration = existing
      ? { ...reg, previous: existing }
      : reg;
    this.#registrations.set(key, stored);
    if (existing) {
      for (const [r] of this.#instances)
        if (r.key === key) this.#instances.delete(r);
      this.#overrides.delete(key);
      this.#emit('replace', {
        key,
        container: this.#view(),
        previous: toInfo(existing, 0),
      });
      this.#propagateNamespaceReplacement(existing, stored);
    }
    this.#emit('add', {
      key,
      replace: !!existing,
      container: this.#view(),
      kind: stored.kind,
    });
  }

  /** O(V+E) depth-first search over the key dependencies visible from this container. */
  #assertNoCycle(reg: Registration) {
    const start = reg.key;
    const visited = new Set<ServiceKey>();
    const visit = (deps: readonly InternalDependency[], path: ServiceKey[]) => {
      for (const d of deps) {
        if (d.type !== 'key') continue;
        if (d.key === start)
          throw new CircularDependencyError([...path, d.key]);
        if (visited.has(d.key)) continue;
        visited.add(d.key);
        const next = this.#lookup(d.key);
        if (next && 'reg' in next)
          visit(next.reg.dependencies, [...path, d.key]);
      }
    };
    visit(reg.dependencies, [start]);
  }

  /** Finds the registration (or override) visible under `key`, starting at this container. */
  #lookup(
    key: ServiceKey,
  ):
    | { reg: Registration; owner: DIContainer<any> }
    | { override: unknown }
    | undefined {
    let current: DIContainer<any> | undefined = this;
    while (current) {
      if (current.#overrides.has(key))
        return { override: current.#overrides.get(key) };
      const reg = current.#registrations.get(key);
      if (reg) return { reg, owner: current };
      current = current.#parent;
    }
    return undefined;
  }

  /** Resolves `key` through this container's middlewares; `NOT_FOUND` when nothing is registered. */
  #get(key: ServiceKey, allowUnresolved: boolean, path: ServiceKey[]): unknown {
    let found = true;
    const resolveInner = (k: ServiceKey) => {
      const value = this.#resolve(k, path);
      if (value === NOT_FOUND) {
        if (k === key) found = false;
        return undefined;
      }
      if (k === key) found = true;
      return value;
    };
    let value: unknown;
    const middlewares = this.#effectiveMiddlewares();
    if (middlewares.length === 0) {
      value = resolveInner(key);
    } else {
      const context: MiddlewareContext = {
        container: this.#view(),
        path: [...path, key],
        depth: path.length,
      };
      const chain = middlewares.reduce<(k: ServiceKey) => unknown>(
        (next, middleware) => (k) =>
          middleware(k, (nextKey = k) => next(nextKey), context),
        resolveInner,
      );
      value = chain(key);
      if (value !== undefined) found = true;
    }
    this.#emit('get', { key, value, container: this.#view() });
    if (!found && value === undefined) {
      if (allowUnresolved) return undefined;
      throw this.#notRegistered(key, [...path, key]);
    }
    return value;
  }

  /**
   * The container that runs `owner`'s registrations for a resolution started here: the nearest isolated
   * fork between this container and the owner, otherwise the owner itself.
   */
  #executorFor(owner: DIContainer<any>): DIContainer<any> {
    let current: DIContainer<any> | undefined = this;
    while (current && current !== owner) {
      if (current.#isolated) return current;
      current = current.#parent;
    }
    return owner;
  }

  /** Re-applies a namespace callback inside this isolated fork, once. */
  #isolatedNamespace(reg: Registration): DIContainer<any> {
    let container = this.#isolatedNamespaces.get(reg);
    if (!container) {
      const result = reg.extension!(this.fork());
      if (!(result instanceof DIContainer)) {
        throw new Error('Namespace extension must return a container.');
      }
      container = result;
      this.#isolatedNamespaces.set(reg, container);
    }
    return container;
  }

  /** Resolution without middlewares: finds the registration and lets the executing container produce it. */
  #resolve(key: ServiceKey, path: ServiceKey[]): unknown {
    const found = this.#lookup(key);
    if (!found) return NOT_FOUND;
    if ('override' in found) return found.override;
    return this.#executorFor(found.owner).#produce(found.reg, [...path, key]);
  }

  #produce(reg: Registration, path: ServiceKey[]): unknown {
    switch (reg.kind) {
      case 'instance':
        return reg.value;
      case 'alias':
        return this.#get(reg.target!, false, path);
      case 'namespace':
        return this === reg.owner
          ? reg.container
          : this.#isolatedNamespace(reg);
      case 'namespace-entry': {
        if (this === reg.owner)
          return reg.container!.#get(reg.target!, false, path);
        const namespace = reg.owner.#registrations.get(reg.namespace!);
        return this.#isolatedNamespace(namespace!).#get(
          reg.target!,
          false,
          path,
        );
      }
      case 'delegate':
        return reg.container!.#get(reg.target!, false, path);
      case 'singleton': {
        if (this.#instances.has(reg)) return this.#instances.get(reg);
        this.#assertNotDisposed();
        const value = this.#create(reg, path);
        this.#instances.set(reg, value);
        if (reg.dispose !== false) this.#own(reg, value);
        if (isThenable(value)) this.#evictOnRejection(reg, value);
        return value;
      }
      case 'transient':
        return this.#create(reg, path);
    }
  }

  #create(reg: Registration, path: ServiceKey[]): unknown {
    if (path.indexOf(reg.key) !== path.length - 1) {
      throw new CircularDependencyError(path);
    }
    const args = reg.dependencies.map((d) =>
      this.#resolveDependency(d, reg, path),
    );
    const factory = reg.construct
      ? callableOf(reg.factory as unknown as new (...args: any[]) => unknown)
      : reg.factory!;
    const value = this.#invoke(factory, args, reg.factory, path);
    this.#emit('produce', { key: reg.key, value, container: this.#view() });
    return value;
  }

  #resolveDependency(
    d: InternalDependency,
    reg: Registration | undefined,
    path: ServiceKey[],
  ): unknown {
    switch (d.type) {
      case 'function':
        return d.fn();
      case 'key':
        return this.#get(d.key, false, path);
      case 'optional':
        return this.#get(d.key, true, path);
      case 'previous': {
        if (reg?.previous) return this.#produce(reg.previous, path);
        // The previous definition lives above the registration's owner.
        const above = reg ? reg.owner.#parent : undefined;
        const found = above ? above.#lookup(d.key) : undefined;
        if (!found) {
          throw new InjecuteError(
            'INJECUTE_NO_PREVIOUS_DEFINITION',
            `"${describeKey(d.key)}" depends on itself, but no previous definition of "${describeKey(d.key)}" is registered.`,
            { path },
          );
        }
        if ('override' in found) return found.override;
        const executor = this === reg!.owner ? found.owner : this;
        return executor.#produce(found.reg, path);
      }
    }
  }

  #adoptNamespace(
    namespace: string,
    container: DIContainer<any>,
    extension: (c: any) => unknown,
  ) {
    this.#register(
      {
        key: namespace,
        kind: 'namespace',
        owner: this,
        namespace,
        container,
        extension,
        dependencies: [],
      },
      false,
    );
    // The returned container may be a fork of a fork: link every level up to this container.
    let level: DIContainer<any> | undefined = container;
    while (level && level !== this) {
      const current: DIContainer<any> = level;
      for (const key of current.ownKeys.filter(isLinkableKey)) {
        this.#linkNamespaceEntry(namespace, current, key);
      }
      current.addEventListener('add', ({ key, replace, kind }) => {
        if (!isLinkableKey(key) || kind === 'delegate') return;
        const linked = namespaceKey(namespace, key);
        const existing = this.#registrations.get(linked);
        if (!existing) {
          this.#linkNamespaceEntry(namespace, current, key);
        } else if (replace && existing.kind !== 'namespace-entry') {
          // the namespace replaced an entry the parent had overridden: the namespace wins again
          this.#registrations.set(linked, {
            key: linked,
            kind: 'namespace-entry',
            owner: this,
            namespace,
            container: current,
            target: key,
            dependencies: [],
          });
        }
      });
      level = current.#parent;
    }
  }

  #linkNamespaceEntry(
    namespace: string,
    container: DIContainer<any>,
    key: string | number,
  ) {
    const linked = namespaceKey(namespace, key);
    if (this.#registrations.has(linked)) return;
    this.#register(
      {
        key: linked,
        kind: 'namespace-entry',
        owner: this,
        namespace,
        container,
        target: key,
        dependencies: [],
      },
      false,
    );
  }

  /** When a parent replaces `NS.key`, the namespace container uses the replacement too. */
  #propagateNamespaceReplacement(replaced: Registration, next: Registration) {
    if (replaced.kind !== 'namespace-entry' || next.kind === 'namespace-entry')
      return;
    if (next.dependencies.some((d) => d.type === 'previous')) return; // decorating: keep the original
    const container = replaced.container!;
    container.#register(
      {
        key: replaced.target!,
        kind: 'delegate',
        owner: container,
        container: this,
        target: replaced.key,
        dependencies: [],
      },
      true,
    );
  }

  #resetChain(stopAt: DIContainer<any>) {
    let level: DIContainer<any> | undefined = this;
    while (level && level !== stopAt) {
      level.reset();
      level = level.#parent;
    }
  }
}

function normalizeDependencies(
  dependencies: readonly unknown[],
  ownKey: ServiceKey | undefined,
): InternalDependency[] {
  return dependencies.map((d): InternalDependency => {
    const optional = optionalKey(d);
    if (optional !== undefined) return { type: 'optional', key: optional };
    if (isKey(d)) {
      return ownKey !== undefined && d === ownKey
        ? { type: 'previous', key: d }
        : { type: 'key', key: d };
    }
    if (typeof d === 'function')
      return { type: 'function', fn: d as () => unknown };
    throw new InjecuteError(
      'INJECUTE_INVALID_DEPENDENCY',
      `Invalid dependency ${String(d)}${ownKey === undefined ? '' : ` of "${describeKey(ownKey)}"`}.`,
    );
  });
}

function toInfo(reg: Registration, depth: number): RegistrationInfo {
  const dependencies = reg.dependencies.map((d): DependencyInfo => {
    switch (d.type) {
      case 'key':
        return { type: 'key', key: d.key };
      case 'previous':
        return { type: 'previous', key: d.key };
      case 'optional':
        return { type: 'optional', key: d.key };
      case 'function':
        return { type: 'function', name: d.fn.name };
    }
  });
  const info: RegistrationInfo = {
    key: reg.key,
    kind: reg.kind,
    dependencies,
    depth,
    ...(reg.target !== undefined ? { target: reg.target } : {}),
    ...(reg.namespace !== undefined ? { namespace: reg.namespace } : {}),
  };
  if (
    (reg.kind === 'namespace-entry' || reg.kind === 'delegate') &&
    reg.container
  ) {
    const linked = reg.container.getRegistration(reg.target!);
    if (linked) return { ...info, linked };
  }
  return info;
}

async function disposeValue(
  value: unknown,
  dispose: DisposeOption<unknown> | undefined,
): Promise<void> {
  if (dispose === false) return;
  if (typeof dispose === 'function') {
    await dispose(value);
    return;
  }
  if (
    (typeof value !== 'object' && typeof value !== 'function') ||
    value === null
  )
    return;
  const disposable = value as Partial<AsyncDisposable & Disposable>;
  if (typeof disposable[asyncDispose] === 'function') {
    await disposable[asyncDispose]!();
  } else if (typeof disposable[syncDispose] === 'function') {
    disposable[syncDispose]!();
  }
}

function factoryError(
  error: unknown,
  name: string,
  factory: unknown,
  path: readonly ServiceKey[],
): InjecuteError {
  if (error instanceof InjecuteError) return error;
  if (!isClass(factory) && isClassCallError(error, factory)) {
    return classNotConstructed(name, factory, path, error);
  }
  return new InjecuteError(
    'INJECUTE_RESOLUTION_FAILED',
    `Failed to create "${name}": ${error instanceof Error ? error.message : String(error)}`,
    { path, cause: error },
  );
}

function classNotConstructed(
  name: string,
  factory: unknown,
  path: readonly ServiceKey[],
  cause: unknown,
): InjecuteError {
  const className = (factory as { name?: string })?.name || 'TheClass';
  return new InjecuteError(
    'INJECUTE_CLASS_NOT_CONSTRUCTED',
    `"${name}" looks like a class that was called without new. Register it as construct(${className}).`,
    { path, cause },
  );
}
