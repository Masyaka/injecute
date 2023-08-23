import {
  Argument,
  ArgumentsKey,
  ArgumentsResolver,
  Callable,
  CallableResult,
  ContainerServices,
  Empty,
  Events,
  FactoryType,
  Func,
  GetOptions,
  Resolve,
  IDIContainer,
  KeysToTypes,
  MapOf,
  Merge,
  optionalDependencySkipKey,
  OptionalDependencySkipKey,
  Resolver,
  ValueOf,
  Flatten,
} from './types';

const firstResultDefaultPredicate = (r: any) => r !== undefined && r !== null;
export const firstResult = <TArgs extends any[], TResult extends any>(
  fns: ((...args: TArgs) => TResult)[],
  predicate: (r: TResult) => boolean = firstResultDefaultPredicate,
) => (...args: TArgs): TResult | undefined => {
  for (const f of fns) {
    const result = f(...args);
    if (predicate(result)) return result;
  }
};

export const argumentsNamesToArguments = (
  argsNames: (ArgumentsKey | (() => any))[],
): Argument[] =>
  argsNames.map((a) =>
    typeof a === 'function'
      ? { getter: a }
      : {
          name: a,
          required: a !== optionalDependencySkipKey,
        },
  );

export type Middleware<
  TServices extends Record<ArgumentsKey, any>,
  Key extends keyof TServices = keyof TServices
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

const callFactory = <D extends any[]>(
  callable: Callable<D, any>,
  dependencies: D,
) => {
  const func = callable as Func<any, any>;
  return func(...(dependencies as Parameters<typeof func>));
};

export type DIContainerConstructorArguments<
  TParentServices extends Record<ArgumentsKey, any> = Empty
> = {
  parentContainer?: IDIContainer<TParentServices>;
};

const factoryTypeKey = Symbol('TransientType');

/**
 * Dependency Injection container
 */
export class DIContainer<
  TParentServices extends Record<ArgumentsKey, any> = Empty,
  TServices extends TParentServices &
    Record<ArgumentsKey, any> = TParentServices & Empty
> implements IDIContainer<TServices> {
  constructor(p?: DIContainerConstructorArguments<TParentServices>) {
    this.#parentContainer = p?.parentContainer;
    this.addArgumentsResolver(DIContainer.resolveArgumentsFromCache);
    this.rebuildMiddlewareStack();
  }

  protected readonly eventHandlers: {
    [E in keyof Events<IDIContainer<TServices>>]: Set<
      (e: Events<IDIContainer<TServices>>[E]) => void
    >;
  } = {
    replace: new Set(),
    add: new Set(),
    reset: new Set(),
    get: new Set(),
  };
  readonly #parentContainer: IDIContainer<TParentServices> | undefined;
  protected getParent() {
    return this.#parentContainer;
  }
  readonly #factories: MapOf<
    {
      [key in keyof TServices]?: {
        callable: Callable<ValueOf<TServices>[], TServices[key]>;
        type: FactoryType;
        beforeResolving?: (k: key) => void;
        afterResolving?: (k: key, instance: TServices[key]) => void;
        beforeReplaced?: (k: key) => void;
      };
    }
  > = new Map();
  protected getFactory<K extends keyof TServices>(k: K) {
    return this.#factories.get(k);
  }
  readonly #singletonInstances: MapOf<
    {
      [key in keyof TServices]?: TServices[key];
    }
  > = new Map();
  readonly #arguments: MapOf<
    { [key in keyof TServices]?: Argument[] }
  > = new Map();
  readonly #argumentsResolvers: ArgumentsResolver[] = [];
  readonly #middlewares: Middleware<TServices>[] = [];
  #middlewareStack!: Resolver<TServices>;

  get keys(): (keyof TServices)[] {
    return Array.from(this.#factories.keys()) as (keyof TServices)[];
  }

  static readonly resolveArgumentsFromCache: ArgumentsResolver = function (
    this,
    _,
    argumentsKey,
  ) {
    return argumentsKey ? this.getArgumentsFor(argumentsKey) : undefined;
  };

  addEventListener<E extends keyof Events<IDIContainer<TServices>>>(
    e: E,
    handler: (e: Events<IDIContainer<TServices>>[E]) => void,
  ) {
    if (e in this.eventHandlers) {
      this.eventHandlers[e].add(handler);
      return this;
    }
    throw this.eventNotSupported(e);
  }

  removeEventListener<E extends keyof Events<IDIContainer<TServices>>>(
    e: E,
    handler: (e: Events<IDIContainer<TServices>>[E]) => void,
  ) {
    if (e in this.eventHandlers) {
      this.eventHandlers[e].delete(handler);
      return this;
    }
    throw this.eventNotSupported(e);
  }

  public getArgumentsFor(argumentsKey: ArgumentsKey): Argument[] | undefined {
    return this.#arguments.get(argumentsKey);
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
    },
  ): IDIContainer<Merge<TServices, Record<K, TResult>>> {
    return this.addFactory(name, () => instance, {
      [factoryTypeKey]: 'instance',
      replace: options?.replace,
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
    TCallable extends Callable<KeysToTypes<Keys, TServices>, any>,
    Keys extends (OptionalDependencySkipKey | keyof TServices | (() => any))[],
    TResult extends CallableResult<TCallable>
  >(
    name: K,
    factory: TCallable,
    options:
      | {
          [factoryTypeKey]?: FactoryType;
          replace?: boolean;
          dependencies?: [...Keys];
          beforeResolving?: (k: K) => void;
          afterResolving?: (k: K, instance: TResult) => void;
          beforeReplaced?: (k: K) => void;
        }
      | [...Keys] = [] as any,
  ): IDIContainer<Merge<TServices, Record<K, TResult>>> {
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
    TCallable extends Callable<KeysToTypes<Keys, TServices>, any>,
    Keys extends (OptionalDependencySkipKey | keyof TServices | (() => any))[],
    TResult extends CallableResult<TCallable>
  >(
    name: K,
    factory: TCallable,
    options:
      | {
          [factoryTypeKey]?: Extract<FactoryType, 'instance'>;
          replace?: boolean;
          dependencies?: [...Keys];
          beforeResolving?: (k: K) => void;
          afterResolving?: (k: K, instance: TResult) => void;
          beforeReplaced?: (k: K) => void;
        }
      | [...Keys] = [] as any,
  ): IDIContainer<Merge<TServices, Record<K, TResult>>> {
    const optionsIsArray = Array.isArray(options);
    return this.addFactory(name, factory, {
      [factoryTypeKey]: ((!optionsIsArray && options?.[factoryTypeKey]) ||
        'singleton') as FactoryType,
      replace: optionsIsArray ? false : options?.replace,
      dependencies: optionsIsArray ? options : options?.dependencies,
      beforeResolving: !optionsIsArray ? options?.beforeResolving : undefined,
      afterResolving: (k: ArgumentsKey, instance: TResult) => {
        this.#singletonInstances.set(name, instance);
        !optionsIsArray && options?.afterResolving?.(k as K, instance);
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
    A extends keyof TServices
  >(name: K, aliasTo: A): IDIContainer<Merge<TServices, { [k in K]: T }>> {
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
    T extends any = TServices[Key]
  >(
    serviceName: Key,
    options?: O,
  ): O['allowUnresolved'] extends true ? T | undefined : T {
    const instance = this.#middlewareStack(serviceName);

    this.onGet(serviceName, instance);

    if (instance) {
      return instance;
    }

    if (options?.allowUnresolved) {
      return undefined as any;
    }

    throw new Error(`No service registered for "${String(serviceName)}" key.`);
  }

  //  ArgumentsResolver
  public addArgumentsResolver(
    ar: ArgumentsResolver,
  ): DIContainer<TParentServices, TServices> {
    this.#argumentsResolvers.push(ar);
    return this;
  }

  readonly resolveArguments: ArgumentsResolver = (fn, argumentsKey) => {
    for (const argumentsResolver of this.#argumentsResolvers) {
      const args = argumentsResolver.call(
        this as IDIContainer<TServices>,
        fn,
        argumentsKey,
      );
      if (args) return args;
    }
  };

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
  bind<
    TResult extends any,
    Keys extends (
      | OptionalDependencySkipKey
      | keyof TServices
      | Resolve<TServices[keyof TServices]>
    )[]
  >(
    keys: [...Keys],
    callable: Callable<KeysToTypes<Keys, TServices>, TResult>,
  ): () => TResult {
    return () => this.injecute(callable, { argumentsNames: keys });
  }

  /**
   * Create getter for specified key.
   *
   * Useful for providing dependencies to namespace.
   * @example
   * ```typescript
   * container.namespace(
   *   'Domain.Context',
   *   (namespace, parent) => namespace
   *     .addTransient('namespaceRequirement1', parent.getter('parentService1'), [])
   *     .addTransient('namespaceRequirement2', parent.getter('parentService2'), [])
   *     .addSingleton('namespaceService', construct(NamespaceServiceClass), ['namespaceRequirement1', 'namespaceRequirement2'])
   * )
   * ```
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
    skipMiddlewares?: boolean;
    skipResolvers?: boolean;
  }): IDIContainer<T> {
    const child = new DIContainer<T>({
      parentContainer: this as IDIContainer<TServices>,
    });

    if (!options?.skipMiddlewares) {
      child.#argumentsResolvers.length = 0;
      this.#argumentsResolvers.forEach((ar) => child.addArgumentsResolver(ar));
    }

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
    } = { fork: true }
  ) {
    const resultContainer = (options.fork ? this.fork() : this) as DIContainer<TServices>;
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
   * Creates isolated container inside current container.
   * Current container will have access to namespace services, but not vice versa.
   * For cases when you want to avoid keys intersection conflict.
   *
   * TODO: Make namespace less independent and isolated,
   *    move actual factories to main container to make `flatten` method more comprehensive
   *
   * @param namespace
   * @param extension
   */
  namespace<
    TNamespace extends string,
    TExtension extends (p: {
      parent: IDIContainer<TServices>;
      namespace: TServices[TNamespace] extends IDIContainer<any>
        ? TServices[TNamespace]
        : IDIContainer<{}>;
    }) => IDIContainer<any>,
    TNamespaceServices extends ContainerServices<ReturnType<TExtension>>
  >(
    namespace: TNamespace,
    extension: TExtension,
  ): IDIContainer<
    Flatten<
      TServices &
        Record<TNamespace, IDIContainer<TNamespaceServices>> &
        {
          [K in keyof TNamespaceServices as K extends string
            ? `${TNamespace}.${K}`
            : never]: TNamespaceServices[K];
        }
    >
  > {
    const instance = this.get(namespace as any, { allowUnresolved: true });
    const namespaceContainerExists =
      typeof instance === 'object' && 'injecute' in instance;
    if (instance && !namespaceContainerExists) {
      throw new Error(
        `Namespace key "${namespace}" already used with non container entry.`,
      );
    }
    const extensionTargetContainer = instance || new DIContainer();
    const namespaceContainer = extension({
      parent: this as any,
      namespace: extensionTargetContainer as any,
    });
    if (namespaceContainerExists && instance !== namespaceContainer) {
      throw new Error(
        'Namespace was already defined you can not replace it, only extend.',
      );
    }
    if (namespaceContainer == (this as any)) {
      throw new Error(
        'Namespace result can not be the same container. Use parent.fork(), provided namespace container or new container as result.',
      );
    }
    if (!namespaceContainerExists) {
      this.adoptNamespaceContainer(namespace, namespaceContainer);
    }

    // @ts-expect-error TServices already modified
    return this;
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
    extensionFunction: (
      container: IDIContainer<S>,
    ) => IDIContainer<Flatten<TServices & T>>,
  ): IDIContainer<Flatten<TServices & T>> {
    const c = this as IDIContainer<TServices>;
    return extensionFunction.apply(c, [c]);
  }

  /**
   * Clear singletons instances cache.
   * When singleton will be required new instance will be created and factory will be executed once more with new dependencies.
   * Helpful when some service is replaced and cached dependant should be created once more.
   *
   * @param resetParent false by default.
   */
  reset(resetParent = false): IDIContainer<TServices> {
    this.#singletonInstances.clear();
    if (resetParent) {
      this.#parentContainer?.reset(resetParent);
    }
    this.onReset(resetParent);
    return this as IDIContainer<TServices>;
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
    TCallable extends Callable<KeysToTypes<Keys, TServices>, TResult>,
    Keys extends (
      | OptionalDependencySkipKey
      | keyof TServices
      | Resolve<TServices[keyof TServices]>
    )[]
  >(
    callable: TCallable,
    options?:
      | {
          argumentsKey?: keyof TServices | ArgumentsKey | undefined;
          argumentsNames?: [...Keys];
        }
      | [...Keys],
  ): CallableResult<TCallable> {
    const optionsIsArray = Array.isArray(options);
    const argumentsNames = optionsIsArray ? options : options?.argumentsNames;
    const argumentsKey = !optionsIsArray ? options?.argumentsKey : undefined;
    const args = this.resolveAndCacheArguments(
      callable,
      argumentsKey,
      argumentsNames,
    );

    if (!args) {
      throw new Error(
        `Not resolved arguments for ${String(
          argumentsKey,
        )} "${callable.toString().substring(0, 50)}"`,
      );
    }

    const dependencies = this.mapAgrsToInstances(args);

    return callFactory(callable, dependencies as any);
  }

  protected assertNotRegistered(name: keyof TServices | ArgumentsKey) {
    if (this.has(name, false)) {
      throw new Error(
        `Factory or instance with name "${String(name)}" already registered`,
      );
    }
  }

  protected resolveInstance: Resolver<TServices> = (name) =>
    this.#singletonInstances.get(name);

  protected resolveFromFactory: Resolver<TServices> = (name) => {
    const factory = this.#factories.get(name);
    if (factory) {
      factory.beforeResolving?.(name);
      const result = this.injecute(
        factory.callable as Callable<any, TServices[typeof name]>,
        {
          argumentsKey: name as any,
        },
      );
      factory.afterResolving?.(name, result);
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

  protected onReplace(name: keyof TServices) {
    const factory = this.#factories.get(name);
    if (!factory) return;
    factory.beforeReplaced?.(name);
    for (const handler of this.eventHandlers.replace) {
      handler({
        key: name,
        container: this as IDIContainer<TServices>,
        replaced: {
          callable: factory.callable,
          type: factory.type,
        },
      });
    }
  }

  protected onAdd(name: keyof TServices, replace: boolean) {
    for (const handler of this.eventHandlers.add) {
      handler({
        key: name,
        replace,
        container: this as IDIContainer<TServices>,
      });
    }
  }

  protected onReset(resetParent: boolean) {
    for (const handler of this.eventHandlers.reset) {
      handler({
        resetParent,
        container: this as IDIContainer<TServices>,
      });
    }
  }

  protected onGet(name: ArgumentsKey, value: any) {
    for (const handler of this.eventHandlers.get) {
      handler({
        key: name,
        value,
        container: this as IDIContainer<TServices>,
      });
    }
  }

  private linkNamespaceService<N extends string, C extends IDIContainer<any>>(
    container: C,
    key: string | number,
    namespace: N,
  ) {
    const namespaceKey = `${namespace}.${key}` as Exclude<
      string,
      OptionalDependencySkipKey | keyof TServices
    >;
    this.addFactory(namespaceKey, () => container.get(key), {
      dependencies: [],
      [factoryTypeKey]: 'namespace-pass-through',
    });
  }

  private adoptNamespaceContainer<
    N extends string,
    C extends IDIContainer<any>
  >(namespace: N, container: C) {
    this.addInstance(namespace as any, container);

    for (const key of container.keys.filter(stringOrNumber)) {
      this.linkNamespaceService(container, key, namespace);
    }

    container.addEventListener('add', ({ key, container }) => {
      if (stringOrNumber(key)) {
        this.linkNamespaceService(container, key, namespace);
      }
    });
  }

  private eventNotSupported(e: string) {
    const supportedEvents = Object.keys(this.eventHandlers)
      .map((k) => `"${k}"`)
      .join(', ');
    return new Error(`Event "${e}" not supported. ${supportedEvents} allowed`);
  }

  private addFactory<
    K extends ArgumentsKey,
    TCallable extends Callable<KeysToTypes<Keys, TServices>, any>,
    Keys extends (
      | OptionalDependencySkipKey
      | keyof TServices
      | (() => TServices[keyof TServices])
    )[],
    TResult extends CallableResult<TCallable>
  >(
    name: K,
    factory: TCallable,
    options?:
      | {
          [factoryTypeKey]?: FactoryType;
          replace?: boolean;
          dependencies?: [...Keys];
          beforeResolving?: (k: K) => void;
          afterResolving?: (k: K, instance: TResult) => void;
          beforeReplaced?: (k: K) => void;
        }
      | [...Keys],
  ): IDIContainer<Merge<TServices, Record<K, TResult>>> {
    const optionsIsArray = Array.isArray(options);
    const replace = !optionsIsArray && !!options?.replace;
    const dependencies = optionsIsArray ? options : options?.dependencies;
    this.validateAdd(name, factory, replace);
    if (replace) {
      if (this.#factories.has(name)) {
        this.onReplace(name as any);
      }
      this.#singletonInstances.delete(name);
    }
    this.resolveAndCacheArguments(factory, name, dependencies);
    this.#factories.set(name, {
      type: ((!optionsIsArray && options?.[factoryTypeKey]) ||
        'transient') as FactoryType,
      beforeResolving: !optionsIsArray ? options?.beforeResolving : undefined,
      afterResolving: !optionsIsArray ? options?.afterResolving : undefined,
      beforeReplaced: !optionsIsArray ? options?.beforeReplaced : undefined,
      callable: factory as Callable<any[], any>,
    });
    this.onAdd(name as any, replace);
    return this as any;
  }

  private rebuildMiddlewareStack() {
    this.#middlewareStack = [
      this.resolve,
      ...this.#middlewares,
    ].reduce((next, current) => (message) =>
      current.apply(this, [message, next as Resolver<TServices>]),
    ) as Resolver<TServices>;
  }

  private resolveAndCacheArguments(
    fn: Callable<any, any>,
    argumentsKey?: ArgumentsKey,
    argumentsNames?: (
      | OptionalDependencySkipKey
      | keyof TServices
      | (() => TServices[keyof TServices])
    )[],
  ) {
    const args: Argument[] | undefined = argumentsNames
      ? argumentsNamesToArguments(argumentsNames)
      : this.resolveArguments<TServices, typeof this>(
          fn as Callable<any, any>,
          argumentsKey,
        );

    if (args && argumentsKey && !this.#arguments.get(argumentsKey)) {
      this.cacheArguments(args, argumentsKey);
    }

    return args;
  }

  private mapAgrsToInstances(args: Argument[]) {
    return args.map((arg) =>
      'getter' in arg
        ? arg.getter()
        : this.get(arg.name as keyof TServices, {
            allowUnresolved: !arg.required,
          }),
    );
  }

  private ensureNoCirculars(
    key: ArgumentsKey,
    stack: ArgumentsKey[] = [],
  ): ArgumentsKey[][] {
    const args = this.#arguments.get(key);
    if (!args) return [stack];
    return args.flatMap((a) => {
      if ('getter' in a) {
        return [];
      }
      const newStack = [...stack, a.name];
      if (stack.includes(a.name)) {
        throw new CircularDependencyError(newStack);
      }
      return this.ensureNoCirculars(a.name, newStack);
    });
  }

  private cacheArguments(
    args: Argument[],
    argumentsKey: keyof TServices | ArgumentsKey,
  ) {
    this.#arguments.set(argumentsKey, args);
    this.ensureNoCirculars(argumentsKey);
    return args;
  }

  private validateAdd(
    name: Exclude<ArgumentsKey, OptionalDependencySkipKey>,
    factory: Callable<any, any>,
    replace?: boolean,
  ) {
    this.assertKeyIsValid(name);
    this.assertFactoryIsAcceptable(factory, name);
    if (!replace) {
      this.assertNotRegistered(name);
    }
  }
}
