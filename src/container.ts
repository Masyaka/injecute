import {
  ArgumentsKey,
  ArgumentsTypes,
  Callable,
  CallableResult,
  ContainerOwnServices,
  Empty,
  Events,
  FactoryType,
  GetOptions,
  IDIContainer,
  KeyForValueOfType,
  DependenciesToTypes,
  MapOf,
  OptionalDependencySkipKey,
  Resolve,
  Resolver,
  ValueOf,
  optionalDependencySkipKey,
  type Dependency,
} from './types';

const firstResultDefaultPredicate = (r: any) => r !== undefined && r !== null;
export const firstResult =
  <TArgs extends any[], TResult extends any>(
    fns: ((...args: TArgs) => TResult)[],
    predicate: (r: TResult) => boolean = firstResultDefaultPredicate,
  ) =>
  (...args: TArgs): TResult | undefined => {
    for (const f of fns) {
      const result = f(...args);
      if (predicate(result)) return result;
    }
  };

export type Middleware<
  TServices extends Record<ArgumentsKey, any>,
  Key extends keyof TServices = keyof TServices,
> = (
  this: DIContainer<TServices>,
  name: Key,
  next: Resolver<TServices>,
) => Resolver<TServices>;

export class CircularDependencyError extends Error {
  constructor(stack: ArgumentsKey[]) {
    const circularStackDescription = stack
      .map((k) => (k === stack[stack.length - 1] ? `*${k.toString()}*` : k))
      .join(' -> ');
    super(`Circular dependency detected ${circularStackDescription}.`);
  }
}

const stringOrNumber = (i: any): i is string | number =>
  ['string', 'number'].includes(typeof i);

const createNamespaceServiceKey = <N extends string, K extends string | number>(
  namespace: N,
  key: K,
) => `${namespace}.${key}`;

export type DIContainerConstructorArguments<
  TParentServices extends Record<ArgumentsKey, any> = Empty,
> = {
  parentContainer?: IDIContainer<TParentServices>;
};

const getContainersChain = (c: IDIContainer<any>) => {
  const result = [];
  let current: IDIContainer<any> | undefined = c;
  do {
    result.push(c);
    current = current.getParent();
  } while (current);
  return result;
};

const factoryTypeKey = Symbol('factoryType');

type Factory<
  TServices extends Record<ArgumentsKey, any>,
  K extends keyof TServices,
  C extends Callable<ValueOf<TServices>[], TServices[K]> = Callable<
    ValueOf<TServices>[],
    TServices[K]
  >,
> = {
  [factoryTypeKey]: FactoryType;
  callable: C;
  dependencies: Dependency<TServices>[];
  beforeResolving?: () => void;
  afterResolving?: (instance: any) => void;
  beforeReplaced?: (newFactory: Factory<TServices, K>) => C | void;
};

const isFactory = (f: unknown): f is Factory<any, any> => {
  return (
    !!f &&
    typeof f === 'object' &&
    'dependencies' in f &&
    'callable' in f &&
    factoryTypeKey in f
  );
};

const isKey = (a: unknown): a is string | number | symbol =>
  ['string', 'number', 'symbol'].includes(typeof a);

/**
 * Dependency Injection container
 */
export class DIContainer<
  TOwnServices extends Record<ArgumentsKey, any> = Empty,
  TParentServices extends Record<ArgumentsKey, any> = Empty,
  TServices extends TParentServices & TOwnServices = TParentServices &
    TOwnServices,
> implements IDIContainer<TParentServices, TServices>
{
  constructor(p?: DIContainerConstructorArguments<TParentServices>) {
    this.#parentContainer = p?.parentContainer;
    this.rebuildMiddlewareStack();
  }

  protected readonly eventHandlers: {
    [E in keyof Events<IDIContainer<TOwnServices, TParentServices>>]: Set<
      (e: Events<IDIContainer<TOwnServices, TParentServices>>[E]) => void
    >;
  } = {
    replace: new Set(),
    add: new Set(),
    reset: new Set(),
    get: new Set(),
    produce: new Set(),
  };
  readonly #parentContainer: IDIContainer<TParentServices> | undefined;
  getParent() {
    return this.#parentContainer;
  }
  readonly #factories: MapOf<{
    [key in keyof TServices]?: Factory<TServices, key>;
  }> = new Map();
  protected getFactory<K extends keyof TServices>(k: K) {
    return this.#factories.get(k);
  }
  readonly #singletonInstances: MapOf<{
    [key in keyof TServices]?: TServices[key];
  }> = new Map();
  readonly #middlewares: Middleware<TServices>[] = [];
  #middlewareStack!: Resolver<TServices>;

  get keys(): (keyof TServices)[] {
    const keys = this.ownKeys;
    const parent = this.getParent();
    if (parent) {
      keys.push(...parent.keys);
    }
    return keys;
  }

  get ownKeys(): (keyof TServices)[] {
    return Array.from(this.#factories.keys()) as (keyof TServices)[];
  }

  protected setSingletonInstance(
    name: keyof (TOwnServices & TParentServices),
    instance: any,
  ) {
    this.#singletonInstances.set(name, instance);
  }

  addEventListener<
    E extends keyof Events<IDIContainer<TOwnServices, TParentServices>>,
  >(
    e: E,
    handler: (
      e: Events<IDIContainer<TOwnServices, TParentServices>>[E],
    ) => void,
  ) {
    if (e in this.eventHandlers) {
      this.eventHandlers[e].add(handler);
      return this;
    }
    throw this.eventNotSupported(e);
  }

  removeEventListener<
    E extends keyof Events<IDIContainer<TOwnServices, TParentServices>>,
  >(
    e: E,
    handler: (
      e: Events<IDIContainer<TOwnServices, TParentServices>>[E],
    ) => void,
  ) {
    if (e in this.eventHandlers) {
      this.eventHandlers[e].delete(handler);
      return this;
    }
    throw this.eventNotSupported(e);
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
    return (
      this.#factories.has(name) ||
      this.#singletonInstances.has(name) ||
      (askParent ? !!this.#parentContainer?.has(name) : false)
    );
  }

  /**
   * Adds existing instance to collection
   * @param name
   * @param instance
   * @param options {{ replace: boolean }}
   */
  addInstance<K extends ArgumentsKey, TResult extends any>(
    name: K,
    instance: TResult,
    options?: {
      replace: boolean;
      beforeResolving?: () => void;
      afterResolving?: (instance: TResult) => void;
      beforeReplaced?: () => () => TResult | void;
    },
  ): IDIContainer<TServices & { [k in K]: TResult }> {
    return this.addFactory(name, () => instance, {
      [factoryTypeKey]: 'instance',
      replace: options?.replace,
      beforeResolving: options?.beforeResolving,
      afterResolving: options?.afterResolving,
      beforeReplaced: options?.beforeReplaced,
      dependencies: [],
    });
  }

  /**
   * Each time requested transient service - factory will be executed and returned new instance.
   * @param name
   * @param factory
   * @param options {{
   *  replace: boolean | undefined,
   *  dependencies: string[] | undefined
   * } | string[]}
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
          [factoryTypeKey]?: FactoryType;
          replace?: boolean;
          dependencies: [...Deps];
          beforeResolving?: () => void;
          afterResolving?: (instance: TResult) => void;
          beforeReplaced?: () => TCallable | void;
        }
      | [...Deps] = [] as any,
  ): IDIContainer<TServices & { [k in K]: TResult }> {
    return this.addFactory(name, factory, options);
  }

  /**
   * Once created instance will be returned for each service request
   * @param name
   * @param factory
   * @param options {{
   *  replace: boolean | undefined,
   *  dependencies: string[] | undefined
   * } | string[]}
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
          [factoryTypeKey]?: Extract<FactoryType, 'instance'>;
          replace?: boolean;
          dependencies: [...Deps];
          beforeResolving?: () => void;
          afterResolving?: (instance: TResult) => void;
          beforeReplaced?: () => TCallable | void;
        }
      | [...Deps] = [] as any,
  ): IDIContainer<TServices & { [k in K]: TResult }> {
    const optionsIsArray = Array.isArray(options);
    return this.addFactory(name, factory, {
      [factoryTypeKey]: ((!optionsIsArray && options?.[factoryTypeKey]) ||
        'singleton') as FactoryType,
      replace: optionsIsArray ? false : options?.replace,
      dependencies: optionsIsArray ? options : options?.dependencies,
      beforeResolving: !optionsIsArray ? options?.beforeResolving : undefined,
      afterResolving: (instance: TResult) => {
        this.setSingletonInstance(name, instance);
        !optionsIsArray && options?.afterResolving?.(instance);
      },
      beforeReplaced: !optionsIsArray ? options?.beforeReplaced : undefined,
    });
  }

  /**
   * When the service with `name` needed - `aliasTo` service will be given.
   * @example ```
   * class MyServiceClass {}
   * container.addSingleton('myService', MyServiceClass);
   * container.addAlias('service', 'myService');
   * expect(container.get('service')).instanceOf(MyServiceClass);
   * ```
   * @param name
   * @param aliasTo
   */
  addAlias<
    T extends TServices[A],
    K extends ArgumentsKey,
    A extends keyof TServices,
  >(name: K, aliasTo: A): IDIContainer<TServices & { [k in K]: T }> {
    return this.addFactory(
      name as Exclude<K, OptionalDependencySkipKey>,
      () => this.get(aliasTo),
      {
        dependencies: [],
        [factoryTypeKey]: 'alias',
      },
    );
  }

  use(middleware: Middleware<any>): DIContainer<TParentServices, TServices> {
    this.#middlewares.push(middleware);
    this.rebuildMiddlewareStack();
    return this;
  }

  /**
   * Get registered service from container
   * @example ```
   * class MyServiceClass {}
   * container.addSingleton('myService', MyServiceClass);
   *
   * // --- much later when developer need MyServiceClass instance ---
   * container.get('myService')
   * ```
   *
   * Return existing instance if allowed by service lifetime or will create new instance.
   * If no service registered it would try to get service from parent container.
   * If no service registered in parent container or no parent container set. It will throw Error
   * @param serviceName
   * @param options {GetOptions}
   */
  get<
    Key extends keyof TServices,
    O extends GetOptions,
    T extends any = TServices[Key],
  >(
    serviceName: Key,
    options?: O,
  ): O['allowUnresolved'] extends true ? T | undefined : T {
    const instance = this.#middlewareStack(serviceName);

    this.onGet(serviceName, instance);

    if (typeof instance !== 'undefined') {
      return instance;
    }

    if (options?.allowUnresolved) {
      return undefined as any;
    }

    throw new Error(`No service registered for "${String(serviceName)}" key.`);
  }

  /**
   * Binds Callable to container with specific arguments keys.
   * "Injecute but later"
   * @example ```
   * const send = (logger, httpClient) => {  ... code using http client and logic  };
   * const sendHttpRequestAndLogResponse = container.bind(['logger', 'httpClient'], send);
   *
   * // --- somewhere else ---
   * sendHttpRequestAndLogResponse() // logger and httpClient will be provided by container.
   * ```
   * @param keys
   * @param callable
   */
  bind<TResult extends any, Deps extends Dependency<TServices>[]>(
    keys: [...Deps],
    callable: Callable<DependenciesToTypes<Deps, TServices>, TResult>,
  ): () => TResult {
    return () => this.injecute(callable, keys);
  }

  /**
   * Create getter for specified key.
   * @param key
   */
  createResolver<K extends keyof TServices>(key: K): Resolve<TServices[K]> {
    return this.get.bind(this, key) as () => TServices[K];
  }

  /**
   * Creates child container.
   * For cases when you don`t want to add service to main container.
   * Will copy arguments resolvers from parent container.
   * @example ```
   * const localRequestContainer = container.fork().addInstance('request', request);
   * container.get('request') // error
   * localRequestContainer.get('request') === request;
   * ```
   */
  fork<T extends TServices = TServices>(options?: {
    skipResolvers?: boolean;
  }): IDIContainer<{}, T> {
    const child = new DIContainer<T>({
      parentContainer: this as IDIContainer<TOwnServices, TParentServices>,
    });

    if (!options?.skipResolvers) {
      this.#middlewares.forEach((m) => child.use(m));
    }

    return child as IDIContainer<T>;
  }

  /**
   * Moves all factories, but not caches from parent containers to current level.
   * Will throw if keys intersection met and `onKeyIntersection` recovery callback not provided.
   */
  flatten(
    options: {
      fork?: boolean;
      onKeyIntersection?: <K extends keyof TServices>(
        k: K,
      ) => Resolve<TServices[K]>;
    } = { fork: true },
  ) {
    // todo: Add tests
    const resultContainer = (
      options.fork ? this.fork() : this
    ) as DIContainer<TServices>;
    let current: DIContainer<any> = this;

    while (true) {
      const parent = current.getParent();
      if (parent instanceof DIContainer) {
        current = parent;
      } else {
        break;
      }

      current.keys.forEach((k: keyof TServices) => {
        if (resultContainer.has(k)) {
          if (options.onKeyIntersection) {
            const factory = options.onKeyIntersection(k);
            resultContainer.addFactory(k, factory, { replace: true });
          } else {
            throw new Error(
              `Keys intersection occurred on key: "${k.toString()}". Use onKeyIntersection recovery mechanism.`,
            );
          }
        }
        const factoryFromParent = current!.getFactory(k);
        resultContainer.#factories.set(k, factoryFromParent);
      });
    }

    return resultContainer;
  }

  /**
   * Adopts callback result container services.
   * Provided fork of current container can be used or new created container.
   * Current container will have access to namespace services with namespace prefix.
   * For cases when you want to avoid keys intersection conflict.
   *
   * Only the returned container services will be exposed in namespace types.
   * It means if you made few forks in namespace and returned latest fork,
   * only registered in latest fork entries will be listed in namespace services type.
   * Btw in runtime every service from returned container can be accessed.
   *
   * @param namespace
   * @param extension
   */
  namespace<
    TNamespace extends string,
    TExtension extends (
      c: IDIContainer<{}, TServices>,
    ) => IDIContainer<any, any>,
    TNamespaceServices extends ContainerOwnServices<ReturnType<TExtension>>,
  >(
    namespace: TNamespace,
    extension: TExtension,
  ): IDIContainer<
    TOwnServices & { [K in TNamespace]: IDIContainer<TNamespaceServices> } & {
      [K in keyof TNamespaceServices as K extends string
        ? `${TNamespace}.${K}`
        : never]: TNamespaceServices[K];
    },
    TParentServices
  > {
    if (this.has(namespace)) {
      throw new Error(`Namespace key "${namespace}" already in use.`);
    }
    const namespaceContainer = extension(this.fork() as any);
    if (namespaceContainer == (this as any)) {
      throw new Error(
        'Namespace result can not be the same container. Use parent.fork(), provided namespace container or new container as result.',
      );
    }
    this.adoptNamespaceContainer(namespace, namespaceContainer);
    return this as any;
  }

  /**
   * Use extension function to add services.
   * @example ```
   * const addSrv1 = function(this: IDIContainer<T>): IDIContainer<T & { srv1: Srv }> {
   *   return this.addSingleton('srv', Srv)
   * }
   * container.extend(addSrv1);
   * container.get('srv1') // Srv
   * ```
   */
  extend<S extends TServices, T extends Record<ArgumentsKey, any>>(
    extensionFunction: (container: IDIContainer<S>) => IDIContainer<T>,
  ): IDIContainer<TServices & T> {
    const c = this as IDIContainer<TOwnServices, TParentServices>;
    const result = extensionFunction.apply(c, [c]);
    if (getContainersChain(result).some((c) => c === this)) {
      return result;
    }
    throw new Error(
      'Extension result container not the same container or its child.',
    );
  }

  /**
   * Clear singletons instances cache.
   * When singleton will be required new instance will be created and factory will be executed once more with new dependencies.
   * Helpful when some service is replaced and cached dependant should be created once more.
   *
   * @param {{
   * resetParent?: boolean;
   * keys?: (keyof (TOwnServices & TParentServices))[];
   * } | undefined} options
   */
  reset(
    options: {
      resetParent?: boolean;
      keys?: (keyof (TOwnServices & TParentServices))[];
    } = {},
  ): IDIContainer<TOwnServices, TParentServices> {
    if (!options.keys) {
      this.#singletonInstances.clear();
    } else {
      options.keys.forEach((k) => {
        this.#singletonInstances.delete(k);
      });
    }
    if (options.resetParent) {
      this.#parentContainer?.reset(options);
    }
    this.onReset(options);
    return this as IDIContainer<TOwnServices, TParentServices>;
  }

  /**
   * If entry under the key is function it will be called with params and optional `this`.
   * @param key
   * @param params
   * @param targetThis
   * @returns
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
   * Executes function or constructor using container dependencies without adding it to container.
   * @example ```
   * container.addInstance('logger', console);
   * //
   * const logger = container.get('logger');
   * const useLogger = (logger) => { logSome }
   * useLogger(logger)
   * // is equivalent to
   * container.injecute((logger) => logSome, ['logger'])
   * ```
   * @param callable
   * @param options
   */
  injecute<
    TResult,
    TCallable extends Callable<DependenciesToTypes<Deps, TServices>, TResult>,
    Deps extends Dependency<TServices>[],
  >(callable: TCallable, dependencies: [...Deps]): CallableResult<TCallable> {
    return this.applyCallable(callable, dependencies as any);
  }

  protected applyCallable<D extends any[]>(
    callable: Callable<D, any>,
    dependencies: D,
  ) {
    const dependenciesInstances: any =
      this.mapDependenciesToInstances(dependencies);
    return callable(...dependenciesInstances) as any;
  }

  protected mapDependenciesToInstances(dependencies: Dependency<TServices>[]) {
    return dependencies.map((d) => {
      if (d === optionalDependencySkipKey) {
        return undefined;
      }
      if (isKey(d)) {
        return this.get(d);
      }
      if (isFactory(d)) {
        return this.injecute(
          d.callable,
          d.dependencies as Dependency<TServices>[],
        );
      }
      if (typeof d === 'function') {
        return d();
      }
      throw new Error(`Invalid dependency type`);
    });
  }

  protected assertNotRegistered(name: keyof TServices | ArgumentsKey) {
    if (this.has(name, false)) {
      throw new Error(
        `Factory or instance with name "${String(name)}" already registered`,
      );
    }
  }

  protected applyFactory(factory: Factory<any, any>) {
    factory.beforeResolving?.();
    const result = this.injecute(
      factory.callable as Callable<any, any>,
      factory.dependencies as Dependency<TServices>[],
    );
    factory.afterResolving?.(result);
    return result;
  }

  protected resolveInstance: Resolver<TServices> = (name) =>
    this.#singletonInstances.get(name);

  protected resolveFromFactory: Resolver<TServices> = (name) => {
    const factory = this.#factories.get(name);
    if (factory) {
      const result = this.applyFactory(factory);
      if (factory[factoryTypeKey] !== 'instance') {
        this.onProduce(name, result);
      }
      return result;
    }
  };

  protected resolveFromParent: Resolver<TServices> = (name) =>
    this.#parentContainer?.get(name, { allowUnresolved: true });

  protected readonly resolve = firstResult([
    this.resolveInstance,
    this.resolveFromFactory,
    this.resolveFromParent,
  ]) as Middleware<TServices>;

  protected assertFactoryIsAcceptable(
    factory: any,
    name: keyof TServices | ArgumentsKey,
  ) {
    if (typeof factory !== 'function') {
      throw new Error(
        `Non function factory or class constructor added for "${String(
          name,
        )}" key`,
      );
    }
  }

  protected assertKeyIsValid(
    k: unknown,
  ): asserts k is Exclude<any, OptionalDependencySkipKey> {
    if (k === optionalDependencySkipKey) {
      throw new Error(
        `"${optionalDependencySkipKey}" key is not allowed as key for service.`,
      );
    }
  }

  protected onReplace(
    name: keyof TServices,
    newFactory: Factory<TServices, keyof TServices>,
  ) {
    const currentFactory = this.#factories.get(name);
    if (!currentFactory) return;
    currentFactory.beforeReplaced?.(newFactory);
    for (const handler of this.eventHandlers.replace) {
      handler({
        key: name,
        container: this as IDIContainer<TOwnServices, TParentServices>,
        replaced: {
          callable: currentFactory.callable,
          type: currentFactory[factoryTypeKey],
        },
      });
    }
  }

  protected onAdd(name: keyof TServices, replace: boolean) {
    for (const handler of this.eventHandlers.add) {
      handler({
        key: name,
        replace,
        container: this as IDIContainer<TOwnServices, TParentServices>,
      });
    }
  }

  protected onReset(resetOptions: {
    resetParent?: boolean;
    keys?: (keyof (TOwnServices & TParentServices))[];
  }) {
    for (const handler of this.eventHandlers.reset) {
      handler({
        resetParent: resetOptions.resetParent || false,
        keys: resetOptions.keys,
        container: this as IDIContainer<TOwnServices, TParentServices>,
      });
    }
  }

  protected onGet(name: ArgumentsKey, value: any) {
    for (const handler of this.eventHandlers.get) {
      handler({
        key: name,
        value,
        container: this as IDIContainer<TOwnServices, TParentServices>,
      });
    }
  }

  protected onProduce(name: ArgumentsKey, value: any) {
    for (const handler of this.eventHandlers.produce) {
      handler({
        key: name,
        value,
        container: this as IDIContainer<TOwnServices, TParentServices>,
      });
    }
  }

  private linkNamespaceService<N extends string, C extends IDIContainer<any>>(
    namespaceContainer: C,
    namespace: N,
    key: string | number,
  ) {
    const namespaceKey = createNamespaceServiceKey(namespace, key) as Exclude<
      string,
      OptionalDependencySkipKey | keyof TServices
    >;
    this.addFactory(namespaceKey, namespaceContainer.createResolver(key), {
      beforeReplaced: () => {
        // if parent container replaces namespace entry, namespace container will use this replaced entry as well
        namespaceContainer.addTransient(
          key,
          this.createResolver(namespaceKey),
          {
            replace: true,
            dependencies: [],
            beforeReplaced: () => {
              this.#factories.delete(namespaceKey);
              this.#singletonInstances.delete(namespaceKey);
            },
          },
        );
      },
      dependencies: [],
      [factoryTypeKey]: 'namespace-pass-through',
    });
  }

  private adoptNamespaceContainer<
    N extends string,
    C extends IDIContainer<any>,
  >(namespace: N, namespaceContainer: C) {
    this.addInstance(namespace as any, namespaceContainer);

    let adoptee: IDIContainer<any> | undefined;
    while (true) {
      const currentAdoptee = (adoptee = !adoptee
        ? namespaceContainer
        : adoptee.getParent());
      if (!currentAdoptee || currentAdoptee === this) {
        break;
      }

      // 1. can't concatenate symbol. 2. symbols are for private services
      for (const key of currentAdoptee.ownKeys.filter(stringOrNumber)) {
        this.linkNamespaceService(currentAdoptee, namespace, key);
      }

      // If for, some reason, something added to namespace after adoption - it should be added as well.
      currentAdoptee.addEventListener('add', ({ key }) => {
        if (!stringOrNumber(key)) return;
        if (this.has(createNamespaceServiceKey(namespace, key))) return;
        this.linkNamespaceService(currentAdoptee, namespace, key);
      });

      this.addEventListener('reset', () => {
        currentAdoptee.reset();
      });
    }
  }

  private eventNotSupported(e: string) {
    const supportedEvents = Object.keys(this.eventHandlers)
      .map((k) => `"${k}"`)
      .join(', ');
    return new Error(`Event "${e}" not supported. ${supportedEvents} allowed`);
  }

  private addFactory<
    K extends ArgumentsKey,
    TCallable extends Callable<DependenciesToTypes<Deps, TServices>, any>,
    Deps extends Dependency<TServices>[],
    TResult extends CallableResult<TCallable>,
  >(
    name: K,
    factory: TCallable,
    options?:
      | {
          [factoryTypeKey]?: FactoryType;
          replace?: boolean;
          dependencies?: [...Deps];
          beforeResolving?: () => void;
          afterResolving?: (instance: TResult) => void;
          beforeReplaced?: (
            oldFactory: Factory<TServices, K>,
          ) => TCallable | void;
        }
      | [...Deps],
  ): IDIContainer<TServices & { [k in K]: TResult }> {
    const optionsIsArray = Array.isArray(options);
    const replace = !optionsIsArray && !!options?.replace;
    const dependencies: Dependency<TServices>[] =
      (optionsIsArray ? options : options?.dependencies) || [];
    const newFactory: Factory<TServices, K> = {
      [factoryTypeKey]: ((!optionsIsArray && options?.[factoryTypeKey]) ||
        'transient') as FactoryType,
      dependencies,
      beforeResolving: !optionsIsArray ? options?.beforeResolving : undefined,
      afterResolving: !optionsIsArray ? options?.afterResolving : undefined,
      beforeReplaced: !optionsIsArray
        ? (options?.beforeReplaced as any)
        : undefined,
      callable: factory as Callable<any[], any>,
    };
    this.validateAdd(name, newFactory, replace);
    if (replace) {
      if (this.#factories.has(name)) {
        this.onReplace(name as any, newFactory);
      }
      const sameKeyIndex = dependencies?.indexOf(name) ?? -1;
      if (sameKeyIndex !== -1) {
        dependencies[sameKeyIndex] = this.getFactory(name) as any;
      }
      this.#singletonInstances.delete(name);
    }
    this.#factories.set(name, newFactory);
    this.onAdd(name as any, replace);
    return this as any;
  }

  private rebuildMiddlewareStack() {
    this.#middlewareStack = [this.resolve, ...this.#middlewares].reduce(
      (next, current) => (message) =>
        current.apply(this, [message, next as Resolver<TServices>]),
    ) as Resolver<TServices>;
  }

  private ensureNoCirculars(
    key: ArgumentsKey,
    stack: ArgumentsKey[] = [],
    initialDependencies?: Dependency<TServices>[],
  ): ArgumentsKey[][] {
    const dependencies =
      initialDependencies || this.#factories.get(key)?.dependencies;
    if (!dependencies) return [stack];
    return dependencies.flatMap((a) => {
      if (isFactory(a) || typeof a === 'function') {
        return [];
      }
      const newStack = [...stack, a];
      if (stack.includes(a)) {
        throw new CircularDependencyError(newStack);
      }
      return this.ensureNoCirculars(a, newStack);
    });
  }

  private validateAdd(
    name: Exclude<ArgumentsKey, OptionalDependencySkipKey>,
    factory: Factory<TServices, keyof TServices>,
    replace?: boolean,
  ) {
    this.ensureNoCirculars(name, replace ? [] : [name], factory.dependencies);
    this.assertKeyIsValid(name);
    this.assertFactoryIsAcceptable(factory.callable, name);
    if (!replace) {
      this.assertNotRegistered(name);
    }
  }
}
