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
  /** the registration this one replaced in the same container */
  readonly previous?: Registration;
}

const NOT_FOUND: unique symbol = Symbol('injecute.notFound');

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
  #middlewareCache: { epoch: number; list: readonly Middleware[] } | undefined;
  /** Bumped by every use()/unuse() anywhere, so cached effective chains are rebuilt. */
  static #middlewareEpoch = 0;
  readonly #listeners: Listeners = {
    add: new Set(),
    replace: new Set(),
    reset: new Set(),
    get: new Set(),
    produce: new Set(),
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
    options?: { replace?: boolean },
  ): IDIContainer<TServices & { [k in K]: TResult }> {
    this.#register(
      {
        key: name,
        kind: 'instance',
        owner: this,
        dependencies: [],
        value: instance,
      },
      !!options?.replace,
    );
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
    return this.#get(serviceName, options?.allowUnresolved ?? false, []) as any;
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
   * Creates child container.
   * For cases when you don`t want to add service to main container.
   */
  fork<T extends TServices = TServices>(options?: {
    /** Inherit middlewares from this container and its ancestors. Default: `true`. */
    middlewares?: boolean;
  }): IDIContainer<Empty, T> {
    const child = this.createChild();
    child.#inheritMiddlewares = options?.middlewares ?? true;
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
    this.#adoptNamespace(namespace, result);
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
      { replace?: boolean; dependencies?: unknown[] } | unknown[] | undefined,
  ) {
    if (typeof factory !== 'function') {
      throw new Error(
        `Non function factory or class constructor added for "${describeKey(key)}" key`,
      );
    }
    const isArray = Array.isArray(options);
    const replace = !isArray && !!options?.replace;
    const dependencies = (isArray ? options : options?.dependencies) ?? [];
    this.#register(
      {
        key,
        kind,
        owner: this,
        factory: factory as (...args: any[]) => unknown,
        dependencies: normalizeDependencies(dependencies, key),
      },
      replace,
    );
  }

  #register(reg: Registration, replace: boolean) {
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

  /** Resolution without middlewares: finds the registration and lets the executing container produce it. */
  #resolve(key: ArgumentsKey, path: ArgumentsKey[]): unknown {
    const found = this.#lookup(key);
    if (!found) return NOT_FOUND;
    if ('override' in found) return found.override;
    return found.owner.#produce(found.reg, [...path, key]);
  }

  #produce(reg: Registration, path: ArgumentsKey[]): unknown {
    switch (reg.kind) {
      case 'instance':
        return reg.value;
      case 'alias':
        return this.#get(reg.target!, false, path);
      case 'namespace':
        return reg.container;
      case 'namespace-entry':
      case 'delegate':
        return reg.container!.#get(reg.target!, false, path);
      case 'singleton': {
        if (this.#instances.has(reg)) return this.#instances.get(reg);
        const value = this.#create(reg, path);
        this.#instances.set(reg, value);
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
        const parent = this.#parent;
        if (!parent)
          throw new Error(
            `No previous definition for "${describeKey(d.key)}".`,
          );
        return parent.#get(d.key, false, path);
      }
    }
  }

  #adoptNamespace(namespace: string, container: DIContainer<any, any>) {
    this.#register(
      {
        key: namespace,
        kind: 'namespace',
        owner: this,
        namespace,
        container,
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
