import {
  Argument,
  ArgumentsKey,
  ArgumentsResolver,
  Callable,
  CallableResult,
  Constructor,
  ContainerServices,
  DependenciesTypes,
  Empty,
  Events,
  Func,
  GetOptions,
  IDIContainer,
  IDIContainerExtension,
  MapOf,
  optionalDependencySkipKey,
  OptionalDependencySkipKey,
  Resolver,
  ValueOf,
} from './types';
import { argumentsNamesToArguments, firstResult } from './utils';

export type Middleware<
  TServices extends Record<ArgumentsKey, any>,
  Key extends keyof TServices = keyof TServices
> = (
  this: DIContainer<TServices>,
  name: Key,
  next: Resolver<TServices>
) => Resolver<TServices>;

export class CircularDependencyError extends Error {
  constructor(stack: ArgumentsKey[]) {
    const circularStackDescription = stack
      .map((k) => (k === stack[stack.length - 1] ? `*${k.toString()}*` : k))
      .join(' -> ');
    super(`Circular dependency detected ${circularStackDescription}.`);
  }
}

const callFactory = <D extends any[]>(
  callable: Callable<D, any>,
  dependencies: D,
  isConstructor?: boolean
) => {
  const useNewKeyword = isConstructor ?? !!callable.prototype?.constructor;

  if (useNewKeyword) {
    const constructor = callable as Constructor<any, any>;
    return new constructor(
      ...(dependencies as ConstructorParameters<typeof constructor>)
    );
  }
  const func = callable as Func<any, any>;
  return func(...(dependencies as Parameters<typeof func>));
};

export type DIContainerConstructorArguments<
  TParentServices extends Record<ArgumentsKey, any> = Empty
> = {
  parentContainer?: IDIContainer<TParentServices>;
};

const factoryTypeKey = Symbol('TransientType');

type FactoryType =
  | 'singleton'
  | 'transient'
  | 'instance'
  | 'alias'
  | 'namespace-passthrough';

/**
 * Dependency Injection container
 */
export class DIContainer<
  TParentServices extends Record<ArgumentsKey, any> = Empty,
  TServices extends TParentServices &
    Record<ArgumentsKey, any> = TParentServices & Empty,
  TContainerKey extends keyof TServices = keyof TServices
> implements IDIContainer<TServices, TContainerKey>
{
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
    add: new Set(),
    reset: new Set(),
    get: new Set(),
  };
  readonly #parentContainer: IDIContainer<TParentServices> | undefined;
  readonly #factories: MapOf<{
    [key in keyof TServices]?: {
      callable: Callable<ValueOf<TServices>[], TServices[key]>;
      type: FactoryType;
      isConstructor?: boolean;
      beforeResolving?: (k: key) => void;
      afterResolving?: (k: key, instance: TServices[key]) => void;
    };
  }> = new Map();
  readonly #singletonInstances: MapOf<{
    [key in keyof TServices]?: TServices[key];
  }> = new Map();
  readonly #arguments: MapOf<{ [key in keyof TServices]?: Argument[] }> =
    new Map();
  readonly #argumentsResolvers: ArgumentsResolver[] = [];
  readonly #middlewares: Middleware<TServices>[] = [];
  #middlewareStack!: Resolver<TServices>;

  get keys(): TContainerKey[] {
    return Array.from(this.#factories.keys()) as TContainerKey[];
  }

  static readonly resolveArgumentsFromCache: ArgumentsResolver = function (
    this,
    _,
    argumentsKey
  ) {
    return argumentsKey ? this.getArgumentsFor(argumentsKey) : undefined;
  };

  private eventNotSupported(e: string) {
    const supportedEvents = Object.keys(this.eventHandlers)
      .map((k) => `"${k}"`)
      .join(', ');
    return new Error(`Event "${e}" not supported. ${supportedEvents} allowed`);
  }

  addEventListener<E extends keyof Events>(
    e: E,
    handler: (e: Events<IDIContainer<TServices>>[E]) => void
  ) {
    if (e in this.eventHandlers) {
      this.eventHandlers[e].add(handler);
      return this;
    }
    throw this.eventNotSupported(e);
  }

  removeEventListener<E extends keyof Events>(
    e: E,
    handler: (e: Events<IDIContainer<TServices>>[E]) => void
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
  has(name: TContainerKey | ArgumentsKey, askParent: boolean = true): boolean {
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
   * @param options {{ override: boolean }}
   */
  addInstance<
    K extends ArgumentsKey,
    NewServices extends TServices & { [k in K]: TResult },
    TResult extends any,
    C extends IDIContainer<NewServices>
  >(
    name: Exclude<K, OptionalDependencySkipKey & TContainerKey>,
    instance: TResult,
    options?: {
      override: boolean;
    }
  ): C {
    this.addSingleton(name, () => instance, {
      override: options?.override,
      isConstructor: false,
      explicitArgumentsNames: [],
    });
    return this as any;
  }

  /**
   * Each time requested transient service - factory will be executed and returned new instance.
   * @param name
   * @param factory
   * @param options {{
   *  override: boolean | undefined,
   *  explicitArgumentsNames: string[] | undefined
   * } | string[]}
   */
  addTransient<
    K extends ArgumentsKey,
    TCallable extends Callable<DependenciesTypes<NewServices, Keys>, any>,
    Keys extends (OptionalDependencySkipKey | TContainerKey)[],
    C extends IDIContainer<NewServices>,
    TResult extends CallableResult<TCallable>,
    NewServices extends TServices & { [k in K]: TResult }
  >(
    name: Exclude<K, Keys[number] & OptionalDependencySkipKey & TContainerKey>,
    factory: TCallable,
    options?:
      | {
          [factoryTypeKey]?: Extract<
            FactoryType,
            'alias' | 'namespace-passthrough'
          >;
          override?: boolean;
          isConstructor?: boolean;
          explicitArgumentsNames?: [...Keys];
          beforeResolving?: (k: K) => void;
          afterResolving?: (k: K, instance: TResult) => void;
        }
      | [...Keys]
  ): C {
    const optionsIsArray = Array.isArray(options);
    const override = !optionsIsArray && !!options?.override;
    const explicitArgumentsNames = optionsIsArray
      ? options
      : options?.explicitArgumentsNames;
    this.validateAdd(name, factory, override);
    if (override) {
      this.#singletonInstances.delete(name);
    }
    this.resolveAndCacheArguments(factory, name, explicitArgumentsNames);
    this.#factories.set(name, {
      type: ((!optionsIsArray && options?.[factoryTypeKey]) ||
        'transient') as FactoryType,
      beforeResolving: !optionsIsArray ? options?.beforeResolving : undefined,
      afterResolving: !optionsIsArray ? options?.afterResolving : undefined,
      callable: factory as Callable<any[], NewServices[typeof name]>,
      isConstructor: !optionsIsArray ? options?.isConstructor : undefined,
    });
    // @ts-expect-error name already is the TContainerKey
    this.onAdd(name);
    return this as any;
  }

  /**
   * Once created instance will be returned for each service request
   * @param name
   * @param factory
   * @param options {{
   *  override: boolean | undefined,
   *  explicitArgumentsNames: string[] | undefined
   * } | string[]}
   */
  addSingleton<
    K extends ArgumentsKey,
    TCallable extends Callable<DependenciesTypes<NewServices, Keys>, any>,
    Keys extends (OptionalDependencySkipKey | TContainerKey)[],
    C extends IDIContainer<NewServices>,
    TResult extends CallableResult<TCallable>,
    NewServices extends TServices & { [k in K]: TResult }
  >(
    name: Exclude<K, Keys[number] & OptionalDependencySkipKey & TContainerKey>,
    factory: TCallable,
    options?:
      | {
          [factoryTypeKey]?: Extract<FactoryType, 'instance'>;
          override?: boolean;
          isConstructor?: boolean;
          explicitArgumentsNames?: [...Keys];
          beforeResolving?: (k: K) => void;
          afterResolving?: (k: K, instance: TResult) => void;
        }
      | [...Keys]
  ): C {
    const optionsIsArray = Array.isArray(options);
    const explicitArgumentsNames = optionsIsArray
      ? options
      : options?.explicitArgumentsNames;
    const override = !optionsIsArray && !!options?.override;
    this.validateAdd(name, factory, override);
    if (override) {
      this.#singletonInstances.delete(name);
    }
    this.resolveAndCacheArguments(factory, name, explicitArgumentsNames);
    this.#factories.set(name, {
      callable: factory,
      type: ((!optionsIsArray && options?.[factoryTypeKey]) ||
        'singleton') as FactoryType,
      beforeResolving: !optionsIsArray ? options?.beforeResolving : undefined,
      afterResolving: (k: typeof name, instance: TResult) => {
        this.#singletonInstances.set(name, instance);
        !optionsIsArray && options?.afterResolving?.(k, instance);
      },
      isConstructor: optionsIsArray ? undefined : options?.isConstructor,
    });
    // @ts-expect-error name already is the TContainerKey
    this.onAdd(name);
    return this as any;
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
    A extends TContainerKey
  >(
    name: Exclude<K, OptionalDependencySkipKey & A>,
    aliasTo: A
  ): IDIContainer<{ [k in K]: T } & TServices> {
    return this.addTransient(name, () => this.get(aliasTo), {
      explicitArgumentsNames: [],
      [factoryTypeKey]: 'alias',
    });
  }

  use(
    middleware: Middleware<any>
  ): DIContainer<TParentServices, TServices, TContainerKey> {
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
    Key extends TContainerKey,
    O extends GetOptions,
    T extends any = TServices[Key]
  >(
    serviceName: Key,
    options?: O
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
    ar: ArgumentsResolver
  ): DIContainer<TParentServices, TServices> {
    this.#argumentsResolvers.push(ar);
    return this;
  }

  readonly resolveArguments: ArgumentsResolver = (fn, argumentsKey) => {
    for (const argumentsResolver of this.#argumentsResolvers) {
      const args = argumentsResolver.call(
        this as IDIContainer<TServices>,
        fn,
        argumentsKey
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
    Keys extends (OptionalDependencySkipKey | TContainerKey)[]
  >(
    keys: [...Keys],
    callable: Callable<DependenciesTypes<TServices, Keys>, TResult>
  ): () => TResult {
    return () => this.injecute(callable, { argumentsNames: keys });
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
   * Creates isolated container inside current container.
   * Current container will have access to namespace services, but not vice versa.
   * For cases when you want to avoid keys intersection conflict.
   * @param namespace
   * @param extension
   */
  namespace<
    TNamespace extends Exclude<
      string,
      OptionalDependencySkipKey &
        (TServices[TContainerKey] extends IDIContainer<any>
          ? never
          : TContainerKey)
    >,
    TExtension extends (
      namespaceContainer: TServices[TNamespace] extends IDIContainer<infer NS>
        ? IDIContainer<NS>
        : IDIContainer<{}>,
      parentNamespaceContainer: IDIContainer<TServices>
    ) => IDIContainer<any>,
    TNamespaceServices extends ReturnType<TExtension> extends IDIContainer<
      infer TNamespaceServices
    >
      ? TNamespaceServices
      : never
  >(
    namespace: TNamespace,
    extension: TExtension
  ): IDIContainer<
    TServices & {
      [k in TNamespace]: IDIContainer<TNamespaceServices>;
    } & {
      [K in `${TNamespace}.${(string | number) &
        keyof TNamespaceServices}`]: TNamespaceServices[K];
    }
  > {
    const instance = this.get(namespace as any, { allowUnresolved: true });
    const isContainer =
      typeof instance === 'object' && (instance as any) instanceof DIContainer;
    if (instance && !isContainer) {
      throw new Error(
        `Namespace key "${namespace}" already used with non container entry.`
      );
    }
    const namespaceContainer =
      instance ||
      new DIContainer<any>().addEventListener('add', ({ name, container }) => {
        if (['string', 'number'].includes(typeof name)) {
          this.addTransient(
            `${namespace}.${name as string}`,
            () => container.get(name),
            {
              explicitArgumentsNames: [],
              [factoryTypeKey]: 'namespace-passthrough',
            }
          );
        }
      });
    if (!instance) {
      this.addInstance(namespace as any, namespaceContainer);
    }
    extension(namespaceContainer as any, this as any);
    return this as IDIContainer<
      TServices & {
        [k in TNamespace]: IDIContainer<TNamespaceServices>;
      } & {
        [K in `${TNamespace}.${(string | number) &
          keyof TNamespaceServices}`]: TNamespaceServices[K];
      }
    >;
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
  extend<
    In extends TServices,
    Added extends Record<ArgumentsKey, any>,
    Out extends In & Added
  >(
    extensionFunction: IDIContainerExtension<In, Added, Out>
  ): IDIContainer<Out> {
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
   * const logger = container.get('logger);
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
    TCallable extends Callable<DependenciesTypes<TServices, Keys>, TResult>,
    Keys extends (OptionalDependencySkipKey | TContainerKey)[]
  >(
    callable: TCallable,
    options?:
      | {
          argumentsKey?: TContainerKey | ArgumentsKey | undefined;
          isConstructor?: boolean;
          argumentsNames?: [...Keys];
        }
      | [...Keys]
  ): CallableResult<TCallable> {
    const optionsIsArray = Array.isArray(options);
    const argumentsNames = optionsIsArray ? options : options?.argumentsNames;
    const argumentsKey = !optionsIsArray ? options?.argumentsKey : undefined;
    const args = this.resolveAndCacheArguments(
      callable,
      argumentsKey,
      argumentsNames
    );

    if (!args) {
      throw new Error(
        `Not resolved arguments for ${String(argumentsKey)} "${callable
          .toString()
          .substring(0, 50)}"`
      );
    }

    const dependencies = this.mapAgrsToInstances(args) as DependenciesTypes<
      TServices,
      Keys
    >;

    return callFactory(
      callable,
      dependencies,
      !optionsIsArray && options?.isConstructor
    );
  }

  protected assertNotRegistered(name: TContainerKey | ArgumentsKey) {
    if (this.has(name, false)) {
      throw new Error(
        `Factory or instance with name "${String(name)}" already registered`
      );
    }
  }

  // TODO: change signature to accept ArgumentsResolverCreator <T>(this: DIContainer<TServices>):
  //  DIContainer<TServices & T> =>

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
          isConstructor: factory.isConstructor,
        }
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
    name: TContainerKey | ArgumentsKey
  ) {
    if (!factory) {
      throw new Error(
        `Falsy factory or class constructor added for "${String(name)}" key`
      );
    }
  }

  protected assertKeyIsValid(
    k: unknown
  ): asserts k is Exclude<any, OptionalDependencySkipKey> {
    if (k === optionalDependencySkipKey) {
      throw new Error(
        `"${optionalDependencySkipKey}" key is not allowed as key for service.`
      );
    }
  }

  protected onAdd(name: TContainerKey) {
    for (const handler of this.eventHandlers.add) {
      handler({
        name,
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
        name,
        value,
        container: this as IDIContainer<TServices>,
      });
    }
  }

  private rebuildMiddlewareStack() {
    this.#middlewareStack = [this.resolve, ...this.#middlewares].reduce(
      (next, current) => (message) =>
        current.apply(this, [message, next as Resolver<TServices>])
    ) as Resolver<TServices>;
  }

  private resolveAndCacheArguments(
    fn: Callable<any, any>,
    argumentsKey?: ArgumentsKey,
    argumentsNames?: (OptionalDependencySkipKey | TContainerKey)[]
  ) {
    const args: Argument[] | undefined = argumentsNames
      ? argumentsNamesToArguments(argumentsNames as string[])
      : (this as IDIContainer<TServices>).resolveArguments(
          fn as Callable<any, any>,
          argumentsKey
        );

    if (args && argumentsKey && !this.#arguments.get(argumentsKey)) {
      this.cacheArguments(args, argumentsKey);
    }

    return args;
  }

  private mapAgrsToInstances(args: Argument[]) {
    return args.map((arg) =>
      this.get(arg.name as TContainerKey, { allowUnresolved: !arg.required })
    );
  }

  private ensureNoCirculars(
    key: ArgumentsKey,
    stack: ArgumentsKey[] = []
  ): ArgumentsKey[][] {
    // todo: use same mechanism to build dep tree
    const args = this.#arguments.get(key);
    if (!args) return [stack];
    return args.flatMap((a) => {
      const newStack = [...stack, a.name];
      if (stack.includes(a.name)) {
        throw new CircularDependencyError(newStack);
      }
      return this.ensureNoCirculars(a.name, newStack);
    });
  }

  private cacheArguments(
    args: Argument[],
    argumentsKey: TContainerKey | ArgumentsKey
  ) {
    this.#arguments.set(argumentsKey, args);
    this.ensureNoCirculars(argumentsKey);
    return args;
  }

  private validateAdd(
    name: Exclude<ArgumentsKey, OptionalDependencySkipKey>,
    factory: Callable<any, any>,
    override?: boolean
  ) {
    this.assertKeyIsValid(name);
    this.assertFactoryIsAcceptable(factory, name);
    if (!override) {
      this.assertNotRegistered(name);
    }
  }
}
