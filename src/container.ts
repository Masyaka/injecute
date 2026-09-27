import {
  ArgumentsKey,
  ArgumentsTypes,
  Callable,
  CallableResult,
  ContainerOwnServices,
  DependenciesToTypes,
  type Dependency,
  type DependencyInfo,
  Empty,
  Events,
  GetOptions,
  IDIContainer,
  KeyForValueOfType,
  optionalDependencySkipKey,
  type RegistrationInfo,
  type RegistrationKind,
  type Middleware,
  type MiddlewareContext,
  Resolve,
} from './types.ts';
import { SET_CACHE_INSTANCE } from './internal.ts';

export class CircularDependencyError extends Error {
  constructor(stack: ArgumentsKey[]) {
    const circularStackDescription = stack
      .map((k) => (k === stack[stack.length - 1] ? `*${k.toString()}*` : k))
      .join(' -> ');
    super(`Circular dependency detected ${circularStackDescription}.`);
  }
}

export type DIContainerConstructorArguments<
  TParentServices extends Record<ArgumentsKey, any> = Empty,
> = {
  parentContainer?: IDIContainer<TParentServices>;
};

/** Internal: a dependency after normalization. */
type InternalDependency =
  | { readonly type: 'key'; readonly key: ArgumentsKey }
  | { readonly type: 'previous'; readonly key: ArgumentsKey }
  | { readonly type: 'function'; readonly fn: () => unknown }
  | { readonly type: 'skip' };

/** Internal: a registration is plain data; the executing container owns produced instances. */
interface Registration {
  readonly key: ArgumentsKey;
  readonly kind: RegistrationKind;
  readonly owner: DIContainer<any, any>;
  readonly dependencies: readonly InternalDependency[];
  readonly factory?: (...args: any[]) => unknown;
  readonly value?: unknown;
  /** alias target, namespace-entry key, or delegate target */
  readonly target?: ArgumentsKey;
  /** namespace-entry: the namespace container; namespace: the container itself; delegate: target container */
  readonly container?: DIContainer<any, any>;
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

/** How a registration's instance is disposed: auto-detect (`true`/unset), never (`false`), or custom. */
export type DisposeOption<T> = boolean | ((instance: T) => unknown);

/** An instance this container created (or was asked to own), in creation order. */
interface Owned {
  readonly seq: number;
  readonly reg: Registration;
  readonly value: unknown;
}

const isKey = (a: unknown): a is string | number | symbol =>
  typeof a === 'string' || typeof a === 'number' || typeof a === 'symbol';

const isLinkableKey = (k: ArgumentsKey): k is string | number =>
  typeof k === 'string' || typeof k === 'number';

const namespaceKey = (namespace: string, key: string | number) =>
  `${namespace}.${key}`;

const describeKey = (k: ArgumentsKey) => String(k);

type Listeners = {
  [E in keyof Events<any>]: Set<(e: any) => void>;
};

/**
 * Dependency Injection container
 */
export class DIContainer<
  TOwnServices extends Record<ArgumentsKey, any> = Empty,
  TParentServices extends Record<ArgumentsKey, any> = Empty,
  TServices extends TParentServices & TOwnServices = TParentServices &
    TOwnServices,
> implements IDIContainer<TParentServices, TServices> {
  readonly #parent: DIContainer<any, any> | undefined;
  readonly #registrations = new Map<ArgumentsKey, Registration>();
  /** instances produced (and owned) by this container, keyed by registration */
  readonly #instances = new Map<Registration, unknown>();
  /** values set with setCacheInstance(); cleared by reset() */
  readonly #overrides = new Map<ArgumentsKey, unknown>();
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
  readonly #isolatedNamespaces = new Map<Registration, DIContainer<any, any>>();
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

  constructor(p?: DIContainerConstructorArguments<TParentServices>) {
    const parent = p?.parentContainer;
    if (parent !== undefined && !(parent instanceof DIContainer)) {
      throw new Error('parentContainer must be a DIContainer.');
    }
    this.#parent = parent;
  }

  /**
   * Creates the container used by {@link fork}. Subclasses keep their type in forks.
   */
  protected createChild(): DIContainer<any, any> {
    const Ctor = this.constructor as new (
      p?: DIContainerConstructorArguments<any>,
    ) => DIContainer<any, any>;
    return new Ctor({ parentContainer: this as unknown as IDIContainer<any> });
  }

  /**
   * Calls a factory. Subclasses (the async container) override it to change how factories run.
   */
  protected invokeFactory(
    factory: (...args: any[]) => unknown,
    args: unknown[],
  ): unknown {
    return factory(...args);
  }

  getParent(): IDIContainer<TParentServices> | undefined {
    return this.#parent as IDIContainer<TParentServices> | undefined;
  }

  get keys(): (keyof TServices)[] {
    const keys = new Set<ArgumentsKey>(this.#registrations.keys());
    for (const k of this.#parent?.keys ?? []) keys.add(k);
    return [...keys] as (keyof TServices)[];
  }

  get ownKeys(): (keyof TServices)[] {
    return [...this.#registrations.keys()] as (keyof TServices)[];
  }

  /**
   * Read-only metadata of the registration visible under `key`, or `undefined`.
   */
  getRegistration(key: ArgumentsKey): RegistrationInfo | undefined {
    let depth = 0;
    let current: DIContainer<any, any> | undefined = this;
    while (current) {
      const reg = current.#registrations.get(key);
      if (reg) return toInfo(reg, depth);
      current = current.#parent;
      depth++;
    }
    return undefined;
  }

  addEventListener<
    E extends keyof Events<IDIContainer<TOwnServices, TParentServices>>,
  >(
    e: E,
    handler: (
      e: Events<IDIContainer<TOwnServices, TParentServices>>[E],
    ) => void,
  ): this {
    if (!(e in this.#listeners)) throw this.#eventNotSupported(e);
    this.#listeners[e].add(handler);
    return this;
  }

  removeEventListener<
    E extends keyof Events<IDIContainer<TOwnServices, TParentServices>>,
  >(
    e: E,
    handler: (
      e: Events<IDIContainer<TOwnServices, TParentServices>>[E],
    ) => void,
  ): this {
    if (!(e in this.#listeners)) throw this.#eventNotSupported(e);
    this.#listeners[e].delete(handler);
    return this;
  }

  /**
   * true if services with such name is registered, false otherwise
   * @param name
   * @param askParent true by default
   */
  has(
    name: keyof TServices | ArgumentsKey,
    askParent: boolean = true,
  ): boolean {
    if (this.#registrations.has(name) || this.#overrides.has(name)) return true;
    return askParent ? !!this.#parent?.has(name) : false;
  }

  /**
   * Adds existing instance to collection
   * @param name
   * @param instance
   * @param options {{ replace: boolean }}
   */
  addInstance<K extends ArgumentsKey, TResult>(
    name: K,
    instance: TResult,
    options?: {
      replace?: boolean;
      /**
       * Instances are created outside the container, so it does not dispose them unless asked:
       * `true` disposes with `[Symbol.asyncDispose]` / `[Symbol.dispose]`, a function disposes with it.
       */
      dispose?: DisposeOption<TResult>;
    },
  ): IDIContainer<TServices & { [k in K]: TResult }> {
    const dispose = options?.dispose ?? false;
    const reg: Registration = {
      key: name,
      kind: 'instance',
      owner: this,
      dependencies: [],
      value: instance,
      dispose,
    };
    this.#register(reg, !!options?.replace);
    if (dispose !== false) this.#own(this.#registrations.get(name)!, instance);
    return this as any;
  }

  /**
   * Each time requested transient service - factory will be executed and returned new instance.
   */
  addTransient<
    K extends ArgumentsKey,
    TCallable extends Callable<DependenciesToTypes<Deps, TServices>, any>,
    Deps extends Dependency<TServices>[],
    TResult extends CallableResult<TCallable>,
  >(
    name: K,
    factory: TCallable,
    options:
      | {
          replace?: boolean;
          dependencies: [...Deps];
        }
      | [...Deps] = [] as any,
  ): IDIContainer<TServices & { [k in K]: TResult }> {
    this.#addFactory('transient', name, factory, options);
    return this as any;
  }

  /**
   * Once created instance will be returned for each service request
   */
  addSingleton<
    K extends ArgumentsKey,
    TCallable extends Callable<DependenciesToTypes<Deps, TServices>, any>,
    Deps extends Dependency<TServices>[],
    TResult extends CallableResult<TCallable>,
  >(
    name: K,
    factory: TCallable,
    options:
      | {
          replace?: boolean;
          dependencies: [...Deps];
          /**
           * How `dispose()` releases the instance. Default: auto-detect `[Symbol.asyncDispose]` /
           * `[Symbol.dispose]`. `false` skips it; a function disposes with it.
           */
          dispose?: DisposeOption<TResult>;
        }
      | [...Deps] = [] as any,
  ): IDIContainer<TServices & { [k in K]: TResult }> {
    this.#addFactory('singleton', name, factory, options);
    return this as any;
  }

  /**
   * When the service with `name` needed - `aliasTo` service will be given.
   * @example ```
   * class MyServiceClass {}
   * container.addSingleton('myService', construct(MyServiceClass));
   * container.addAlias('service', 'myService');
   * expect(container.get('service')).instanceOf(MyServiceClass);
   * ```
   */
  addAlias<
    T extends TServices[A],
    K extends ArgumentsKey,
    A extends keyof TServices,
  >(name: K, aliasTo: A): IDIContainer<TServices & { [k in K]: T }> {
    this.#register(
      {
        key: name,
        kind: 'alias',
        owner: this,
        target: aliasTo,
        dependencies: [{ type: 'key', key: aliasTo }],
      },
      false,
    );
    return this as any;
  }

  /**
   * Adds a middleware around every resolution started from this container and its forks.
   *
   * A middleware receives the key, a `next` function that continues the resolution (optionally with
   * another key) and a context with the resolution path. The last added middleware runs first.
   * Middlewares added to a parent later still apply to existing forks.
   *
   * @example
   * ```ts
   * container.use((key, next, { depth }) => {
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
   * Get registered service from container
   *
   * Return existing instance if allowed by service lifetime or will create new instance.
   * If no service registered it would try to get service from parent container.
   * If no service registered in parent container or no parent container set. It will throw Error
   */
  get<Key extends keyof TServices, O extends GetOptions, T = TServices[Key]>(
    serviceName: Key,
    options?: O,
  ): O['allowUnresolved'] extends true ? T | undefined : T {
    this.#assertNotDisposed();
    return this.#get(serviceName, options?.allowUnresolved ?? false, []) as any;
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
   * await using scope = app.fork().addInstance('request', request);
   * // ... scope and its singletons are disposed at the end of the block
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

  /**
   * Binds Callable to container with specific arguments keys.
   * "Injecute but later"
   */
  bind<TResult, Deps extends Dependency<TServices>[]>(
    keys: [...Deps],
    callable: Callable<DependenciesToTypes<Deps, TServices>, TResult>,
  ): () => TResult {
    return () => this.injecute(callable, keys);
  }

  /**
   * Create getter for specified key.
   */
  createResolver<K extends keyof TServices>(key: K): Resolve<TServices[K]> {
    return () => this.get(key);
  }

  /**
   * Creates a child container. The child sees every service of this container (and later additions to it);
   * services added to the child stay in the child.
   *
   * - By default a service registered in this container runs **here** and is shared by all forks,
   *   so overriding one of its dependencies in a fork does not affect it.
   * - With `isolated: true` the fork runs and caches **every** service it resolves, including ones
   *   registered here. Overrides in the fork then reach the whole graph, and nothing leaks back.
   *   Use it for tests and per-tenant variants.
   *
   * @example
   * ```ts
   * const requestScope = app.fork().addInstance('request', request);
   *
   * const testContainer = app.fork({ isolated: true }).addInstance('db', fakeDb, { replace: true });
   * testContainer.get('userRepository'); // built with fakeDb; app is untouched
   * ```
   */
  fork<T extends TServices = TServices>(options?: {
    /** Run and own every resolved service in the fork (see above). Default: `false`. */
    isolated?: boolean;
    /** Inherit middlewares from this container and its ancestors. Default: `true`. */
    middlewares?: boolean;
  }): IDIContainer<Empty, T> {
    this.#assertNotDisposed();
    const child = this.createChild();
    child.#inheritMiddlewares = options?.middlewares ?? true;
    child.#isolated = options?.isolated ?? false;
    return child as any;
  }

  /**
   * Adopts callback result container services under the `namespace.` key prefix.
   */
  namespace<
    TNamespace extends string,
    TExtension extends (
      c: IDIContainer<Empty, TServices>,
    ) => IDIContainer<any, any>,
    TNamespaceServices extends ContainerOwnServices<ReturnType<TExtension>>,
  >(
    namespace: TNamespace,
    extension: TExtension,
  ): IDIContainer<
    TOwnServices & { [K in TNamespace]: IDIContainer<TNamespaceServices> } & {
      [
        K in keyof TNamespaceServices as K extends string
          ? `${TNamespace}.${K}`
          : never
      ]: TNamespaceServices[K];
    },
    TParentServices
  > {
    if (this.has(namespace)) {
      throw new Error(`Namespace key "${namespace}" already in use.`);
    }
    const result = extension(this.fork() as any);
    if ((result as unknown) === this) {
      throw new Error(
        'Namespace result can not be the same container. Use parent.fork(), provided namespace container or new container as result.',
      );
    }
    if (!(result instanceof DIContainer)) {
      throw new Error('Namespace extension must return a container.');
    }
    this.#adoptNamespace(namespace, result, extension);
    return this as any;
  }

  /**
   * Use extension function to add services.
   */
  extend<S extends TServices, T extends Record<ArgumentsKey, any>>(
    extensionFunction: (container: IDIContainer<S>) => IDIContainer<T>,
  ): IDIContainer<TServices & T> {
    const c = this as unknown as IDIContainer<S>;
    const result = extensionFunction.call(c, c);
    let current: unknown = result;
    while (current instanceof DIContainer) {
      if (current === this) return result as any;
      current = current.#parent;
    }
    throw new Error(
      'Extension result container not the same container or its child.',
    );
  }

  /**
   * Clear singletons instances cache.
   */
  reset(
    options: {
      resetParent?: boolean;
      keys?: (keyof (TOwnServices & TParentServices))[];
    } = {},
  ): IDIContainer<TOwnServices, TParentServices> {
    const keys = options.keys ? new Set<ArgumentsKey>(options.keys) : undefined;
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
    if (options.resetParent) this.#parent?.reset(options as any);
    this.#emit('reset', {
      resetParent: options.resetParent || false,
      keys: options.keys,
      container: this,
    });
    return this as any;
  }

  /**
   * If entry under the key is function it will be called with params and optional `this`.
   */
  call<
    FnKey extends KeyForValueOfType<TServices, (...p: any[]) => any>,
    Fn extends TServices[FnKey],
  >(
    key: FnKey,
    params: ArgumentsTypes<Fn>,
    targetThis: any = null,
  ): ReturnType<Fn> {
    const value = this.get(key);
    if (typeof value !== 'function') {
      throw new Error(
        `Entry "${String(key)}" is not a function and can not be invoked`,
      );
    }
    return value.apply(targetThis, params);
  }

  /**
   * Executes function using container dependencies without adding it to container.
   */
  injecute<
    TResult,
    TCallable extends Callable<DependenciesToTypes<Deps, TServices>, TResult>,
    Deps extends Dependency<TServices>[],
  >(callable: TCallable, dependencies: [...Deps]): CallableResult<TCallable> {
    const deps = normalizeDependencies(dependencies, undefined);
    const args = deps.map((d) => this.#resolveDependency(d, undefined, []));
    return this.invokeFactory(callable, args) as any;
  }

  /** @internal Used by setCacheInstance(). */
  [SET_CACHE_INSTANCE](key: ArgumentsKey, value: unknown): void {
    this.#overrides.set(key, value);
  }

  // ---------------------------------------------------------------- internals

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

  #assertNotDisposed() {
    if (this.#disposed) {
      throw new Error('This container is disposed.');
    }
  }

  /** This container plus the namespace containers it owns (and theirs), up to this container. */
  #ownedContainers(): DIContainer<any, any>[] {
    const result: DIContainer<any, any>[] = [this];
    const addChain = (container: DIContainer<any, any>) => {
      for (
        let level: DIContainer<any, any> | undefined = container;
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
      if (done.has(value)) continue;
      done.add(value);
      try {
        await disposeValue(value, reg.dispose);
      } catch (error) {
        errors.push(error);
      }
    }
    for (const container of containers) {
      container.#owned = [];
      container.#instances.clear();
    }
    this.#emit('dispose', { container: this });
    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        `Failed to dispose ${errors.length} service(s).`,
      );
    }
  }

  #eventNotSupported(e: string) {
    const supported = Object.keys(this.#listeners)
      .map((k) => `"${k}"`)
      .join(', ');
    return new Error(`Event "${e}" not supported. ${supported} allowed`);
  }

  #emit<E extends keyof Listeners>(event: E, payload: object) {
    const handlers = this.#listeners[event];
    if (handlers.size === 0) return;
    for (const handler of handlers) handler(payload);
  }

  #addFactory(
    kind: 'singleton' | 'transient',
    key: ArgumentsKey,
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
      throw new Error(
        `Non function factory or class constructor added for "${describeKey(key)}" key`,
      );
    }
    const isArray = Array.isArray(options);
    const replace = !isArray && !!options?.replace;
    const dependencies = (isArray ? options : options?.dependencies) ?? [];
    const dispose = isArray ? undefined : options?.dispose;
    if (kind === 'transient' && dispose !== undefined && dispose !== false) {
      throw new Error(
        `"dispose" is not supported for transient "${describeKey(key)}": the container does not keep transient instances.`,
      );
    }
    this.#register(
      {
        key,
        kind,
        owner: this,
        factory: factory as (...args: any[]) => unknown,
        dependencies: normalizeDependencies(dependencies, key),
        dispose,
      },
      replace,
    );
  }

  #register(reg: Registration, replace: boolean) {
    this.#assertNotDisposed();
    const key = reg.key;
    if (key === optionalDependencySkipKey) {
      throw new Error(
        `"${optionalDependencySkipKey}" key is not allowed as key for service.`,
      );
    }
    const existing = this.#registrations.get(key);
    if (existing && !replace) {
      throw new Error(
        `Factory or instance with name "${describeKey(key)}" already registered. Pass { replace: true } to replace it.`,
      );
    }
    const usesPrevious = reg.dependencies.some((d) => d.type === 'previous');
    if (usesPrevious && !existing && !this.#parent?.has(key)) {
      throw new CircularDependencyError([key, key]);
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
        container: this,
        previous: toInfo(existing, 0),
      });
      this.#propagateNamespaceReplacement(existing, stored);
    }
    this.#emit('add', {
      key,
      replace: !!existing,
      container: this,
      kind: stored.kind,
    });
  }

  /** O(V+E) depth-first search over the key dependencies visible from this container. */
  #assertNoCycle(reg: Registration) {
    const start = reg.key;
    const visited = new Set<ArgumentsKey>();
    const visit = (
      deps: readonly InternalDependency[],
      path: ArgumentsKey[],
    ) => {
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
    key: ArgumentsKey,
  ):
    | { reg: Registration; owner: DIContainer<any, any> }
    | { override: unknown }
    | undefined {
    let current: DIContainer<any, any> | undefined = this;
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
  #get(
    key: ArgumentsKey,
    allowUnresolved: boolean,
    path: ArgumentsKey[],
  ): unknown {
    let found = true;
    const resolveInner = (k: ArgumentsKey) => {
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
        container: this as any,
        path: [...path, key],
        depth: path.length,
      };
      const chain = middlewares.reduce<(k: ArgumentsKey) => unknown>(
        (next, middleware) => (k) =>
          middleware(k, (nextKey = k) => next(nextKey), context),
        resolveInner,
      );
      value = chain(key);
      if (value !== undefined) found = true;
    }
    this.#emit('get', { key, value, container: this });
    if (!found && value === undefined) {
      if (allowUnresolved) return undefined;
      throw new Error(`No service registered for "${describeKey(key)}" key.`);
    }
    return value;
  }

  /**
   * The container that runs `owner`'s registrations for a resolution started here: the nearest isolated
   * fork between this container and the owner, otherwise the owner itself.
   */
  #executorFor(owner: DIContainer<any, any>): DIContainer<any, any> {
    let current: DIContainer<any, any> | undefined = this;
    while (current && current !== owner) {
      if (current.#isolated) return current;
      current = current.#parent;
    }
    return owner;
  }

  /** Re-applies a namespace callback inside this isolated fork, once. */
  #isolatedNamespace(reg: Registration): DIContainer<any, any> {
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
  #resolve(key: ArgumentsKey, path: ArgumentsKey[]): unknown {
    const found = this.#lookup(key);
    if (!found) return NOT_FOUND;
    if ('override' in found) return found.override;
    return this.#executorFor(found.owner).#produce(found.reg, [...path, key]);
  }

  #produce(reg: Registration, path: ArgumentsKey[]): unknown {
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
        return value;
      }
      case 'transient':
        return this.#create(reg, path);
    }
  }

  #create(reg: Registration, path: ArgumentsKey[]): unknown {
    if (path.indexOf(reg.key) !== path.length - 1) {
      throw new CircularDependencyError(path);
    }
    const args = reg.dependencies.map((d) =>
      this.#resolveDependency(d, reg, path),
    );
    const value = this.invokeFactory(reg.factory!, args);
    this.#emit('produce', { key: reg.key, value, container: this });
    return value;
  }

  #resolveDependency(
    d: InternalDependency,
    reg: Registration | undefined,
    path: ArgumentsKey[],
  ): unknown {
    switch (d.type) {
      case 'skip':
        return undefined;
      case 'function':
        return d.fn();
      case 'key':
        return this.#get(d.key, false, path);
      case 'previous': {
        if (reg?.previous) return this.#produce(reg.previous, path);
        // The previous definition lives above the registration's owner.
        const above = reg ? reg.owner.#parent : undefined;
        const found = above ? above.#lookup(d.key) : undefined;
        if (!found) {
          throw new Error(
            `No previous definition for "${describeKey(d.key)}".`,
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
    container: DIContainer<any, any>,
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
    let level: DIContainer<any, any> | undefined = container;
    while (level && level !== this) {
      const current: DIContainer<any, any> = level;
      for (const key of current.ownKeys.filter(isLinkableKey)) {
        this.#linkNamespaceEntry(namespace, current, key);
      }
      current.addEventListener('add', ({ key, replace, kind }: any) => {
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
    container: DIContainer<any, any>,
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

  #resetChain(stopAt: DIContainer<any, any>) {
    let level: DIContainer<any, any> | undefined = this;
    while (level && level !== stopAt) {
      level.reset();
      level = level.#parent;
    }
  }
}

function normalizeDependencies(
  dependencies: readonly unknown[],
  ownKey: ArgumentsKey | undefined,
): InternalDependency[] {
  return dependencies.map((d): InternalDependency => {
    if (d === optionalDependencySkipKey) return { type: 'skip' };
    if (isKey(d)) {
      return ownKey !== undefined && d === ownKey
        ? { type: 'previous', key: d }
        : { type: 'key', key: d };
    }
    if (typeof d === 'function')
      return { type: 'function', fn: d as () => unknown };
    throw new Error(`Invalid dependency type`);
  });
}

function toInfo(reg: Registration, depth: number): RegistrationInfo {
  const dependencies = reg.dependencies.map((d): DependencyInfo => {
    switch (d.type) {
      case 'key':
        return { type: 'key', key: d.key };
      case 'previous':
        return { type: 'previous', key: d.key };
      case 'function':
        return { type: 'function', name: d.fn.name };
      case 'skip':
        return { type: 'skip' };
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
