export type ValueOf<T> = T[keyof T];
export type Empty = {
  /*  */
};
export type Constructor<TParams extends readonly any[], TResult> = {
  new (...params: TParams): TResult;
};
export type Func<TParams extends readonly any[], TResult> = (
  ...params: TParams
) => TResult;
export type Callable<TParams extends readonly any[], TResult> =
  | Constructor<TParams, TResult>
  | Func<TParams, TResult>;
export type CallableResult<TCallable> = TCallable extends Constructor<any, any>
  ? InstanceType<TCallable>
  : TCallable extends Func<any, any>
  ? ReturnType<TCallable>
  : unknown;
export type Argument =
  | { name: ArgumentsKey; required: boolean }
  | { resolver: () => any };
export type Resolver<TServices> = <Key extends keyof TServices>(
  name: Key
) => TServices[Key] | undefined;
export type Factory<K, TServices> = K extends keyof TServices
  ? Callable<ValueOf<TServices>[], TServices[K]>
  : Callable<ValueOf<TServices>[], any>;

export type GetOptions = { allowUnresolved: boolean };

export type Getter<TServices extends Record<string, any>> =
  () => TServices[keyof TServices];

type DependenciesTypesEntry<
  TServices extends Record<string, any>,
  K extends keyof TServices | Getter<TServices>
> = K extends OptionalDependencySkipKey
  ? undefined
  : K extends keyof TServices
  ? TServices[K]
  : K extends () => any
  ? ReturnType<K>
  : never;
export const optionalDependencySkipKey = 'undefined' as const;
export type OptionalDependencySkipKey = typeof optionalDependencySkipKey;

/**
 * Map keys tuple to types tuple
 * @example
 * ```
 * type deps = DependenciesTypes<{ x: 1, y: string  }, ['x', 'y']> // === [number, string]
 * ```
 */
export type DependenciesTypes<
  TServices extends Record<string, any>,
  Keys extends readonly (keyof TServices | Getter<TServices>)[] = readonly (
    | keyof TServices
    | Getter<TServices>
  )[]
> = [
  DependenciesTypesEntry<TServices, Keys[0]>,
  DependenciesTypesEntry<TServices, Keys[1]>,
  DependenciesTypesEntry<TServices, Keys[2]>,
  DependenciesTypesEntry<TServices, Keys[3]>,
  DependenciesTypesEntry<TServices, Keys[4]>,
  DependenciesTypesEntry<TServices, Keys[5]>,
  DependenciesTypesEntry<TServices, Keys[6]>,
  DependenciesTypesEntry<TServices, Keys[7]>,
  DependenciesTypesEntry<TServices, Keys[8]>,
  DependenciesTypesEntry<TServices, Keys[9]>
];

export type ArgumentsKey = string | symbol | number;

export type ArgumentsResolver = <
  TServices extends Record<ArgumentsKey, any>,
  TContainerKey extends keyof TServices,
  C extends IDIContainer<TServices, TContainerKey>
>(
  this: C,
  fn: Callable<any, any>,
  argumentsKey?: ArgumentsKey
) => Argument[] | undefined;

export type IDIContainerExtension<
  In extends Record<string, any>,
  Added extends Record<string, any>,
  Out extends In & Added = In & Added
> = (this: IDIContainer<In>, c: IDIContainer<In>) => IDIContainer<Out>;

export type ContainerServices<C extends IDIContainer<any>> =
  C extends IDIContainer<infer S> ? S : never;

export type NamespaceServices<
  C extends IDIContainer<any>,
  N extends keyof ContainerServices<C>
> = ContainerServices<C>[N] extends IDIContainer<any>
  ? ContainerServices<ContainerServices<C>[N]>
  : `${N extends string ? N : ''} is not a namespace container`;

export type InjecuteOptions<
  TContainerKey,
  Keys extends readonly (
    | OptionalDependencySkipKey
    | TContainerKey
    | Getter<any>
  )[]
> = {
  argumentsKey?: TContainerKey | undefined;
  isConstructor?: boolean;
  argumentsNames?: [...Keys];
};

/**
 * Actually the Map but...
 */
export interface MapOf<T> extends Map<keyof T, ValueOf<T>> {
  get<K extends keyof T>(k: K): T[K];

  set<K extends keyof T, V extends T[K]>(k: K, v: V): this;
}

export type Merge<
  T1 extends Record<string, unknown>,
  T2 extends Record<string, unknown>
> = {
  [K in keyof (T1 & T2)]: K extends keyof T2
    ? T2[K]
    : K extends keyof T1
    ? T1[K]
    : never;
};

export type FactoryType =
  | 'singleton'
  | 'transient'
  | 'instance'
  | 'alias'
  | 'namespace-passthrough';

export type Events<C extends IDIContainer<any>> = {
  add: { name: ArgumentsKey; replace: boolean; container: C };
  replace: {
    name: ArgumentsKey;
    container: C;
    replaced: {
      callable: Callable<any, any>;
      isConstructor: boolean;
      type: FactoryType;
    };
  };
  reset: { resetParent: boolean; container: C };
  get: { name: ArgumentsKey; value: any; container: C };
};

export interface IDIContainer<
  TServices extends Record<ArgumentsKey, any>,
  TContainerKey extends keyof TServices = keyof TServices
> {
  readonly resolveArguments: ArgumentsResolver;

  addEventListener<E extends keyof Events<this>>(
    e: E,
    handler: (e: Events<IDIContainer<TServices>>[E]) => void
  ): this;

  removeEventListener<E extends keyof Events<this>>(
    e: E,
    handler: (e: Events<IDIContainer<TServices>>[E]) => void
  ): this;

  getArgumentsFor(argumentsKey: ArgumentsKey): Argument[] | undefined;

  /**
   * true if services with such key is registered, false otherwise
   * @param name
   */
  has(name: TContainerKey | string): boolean;

  get keys(): TContainerKey[];

  /**
   * Adds existing instance to collection
   * @param name
   * @param instance
   * @param options {{ replace: boolean }}
   */
  addInstance<K extends ArgumentsKey, TResult extends any>(
    name: Exclude<K, OptionalDependencySkipKey & TContainerKey>,
    instance: TResult,
    options?: {
      replace: boolean;
    }
  ): IDIContainer<Merge<TServices, Record<K, TResult>>>;

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
    TCallable extends Callable<DependenciesTypes<NewServices, Keys>, any>,
    Keys extends (
      | OptionalDependencySkipKey
      | TContainerKey
      | Getter<TServices>
    )[],
    C extends IDIContainer<NewServices>,
    TResult extends CallableResult<TCallable>,
    NewServices extends Merge<TServices, Record<K, TResult>>
  >(
    this: unknown,
    name: Exclude<K, Keys[number] & OptionalDependencySkipKey & TContainerKey>,
    factory: TCallable,
    options?:
      | {
          replace?: boolean;
          isConstructor?: boolean;
          dependencies?: [...Keys];
          beforeResolving?: (k: K) => void;
          afterResolving?: (k: K, instance: TResult) => void;
          beforeReplaced?: (k: K) => void;
        }
      | [...Keys]
  ): C;

  /**
   * Once created instance will be returned for each service request
   * @param name
   * @param factory function or constructor
   * @param options {{
   *  replace: boolean | undefined,
   *  dependencies: string[] | undefined
   * } | string[]}
   */
  addSingleton<
    K extends ArgumentsKey,
    TCallable extends Callable<DependenciesTypes<NewServices, Keys>, any>,
    Keys extends (OptionalDependencySkipKey | TContainerKey | Getter<any>)[],
    C extends IDIContainer<NewServices>,
    TResult extends CallableResult<TCallable>,
    NewServices extends Merge<TServices, Record<K, TResult>>
  >(
    this: unknown,
    name: Exclude<K, Keys[number] & OptionalDependencySkipKey & TContainerKey>,
    factory: TCallable,
    options?:
      | {
          replace?: boolean;
          isConstructor?: boolean;
          dependencies?: [...Keys];
          beforeResolving?: (k: K) => void;
          afterResolving?: (k: K, instance: TResult) => void;
          beforeReplaced?: (k: K) => void;
        }
      | [...Keys]
  ): C;

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
  ): IDIContainer<Merge<TServices, Record<K, T>>>;

  /**
   * Get registered service from container
   *
   * Return existing instance if allowed by service lifetime or will create new instance.
   * If no service registered it would try to get service from parent container.
   * If no service registered in parent container or no parent container set. It will throw Error
   *
   * @example ```
   * class MyServiceClass {}
   * container.addSingleton('myService', MyServiceClass);
   *
   * // --- much later when developer need MyServiceClass instance ---
   * container.get('myService')
   * ```
   *
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
  ): O['allowUnresolved'] extends true ? T | undefined : T;

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
    Keys extends readonly (OptionalDependencySkipKey | TContainerKey)[]
  >(
    keys: [...Keys],
    callable: Callable<DependenciesTypes<TServices, Keys>, TResult>
  ): () => TResult;

  /**
   * Create getter for specified key
   * Useful for providing dependencies to namespace
   * @example
   * ```typescript
   * container.namespace(
   *   'Domain.Context',
   *   (namespace, parent) => namespace
   *     .addTransient('namespaceRequirement1', parent.getter('parentService1'), [])
   *     .addTransient('namespaceRequirement2', parent.getter('parentService2'), [])
   *     .addSingleton('namespaceService', asNew(NamespaceServiceClass), ['namespaceRequirement1', 'namespaceRequirement2'])
   * )
   * ```
   * @param key
   */
  getter<K extends TContainerKey>(key: K): () => TServices[K];

  /**
   * Creates child container.
   * Child container will have access to all parent services but not vice versa.
   * For cases when you don`t want to add service to main container.
   * @example ```
   * const localRequestContainer = container.fork().addInstance('request', request);
   * container.get('request') // error
   * localRequestContainer.get('request') === request;
   * ```
   */
  fork<T extends TServices = TServices>(options?: {
    skipMiddlewares?: boolean;
    skipResolvers?: boolean;
  }): IDIContainer<T>;

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
    TNamespaceServices extends ContainerServices<ReturnType<TExtension>>
  >(
    namespace: TNamespace,
    extension: TExtension
  ): IDIContainer<
    TServices &
      Record<TNamespace, IDIContainer<TNamespaceServices>> & {
        [K in keyof TNamespaceServices as K extends string
          ? `${TNamespace}.${K}`
          : never]: TNamespaceServices[K];
      }
  >;

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
    Added extends Record<ArgumentsKey, any>,
    In extends TServices = TServices,
    Out extends Merge<In, Added> = Merge<In, Added>
  >(
    extensionFunction: IDIContainerExtension<In, Added, Out>
  ): IDIContainer<Out>;

  /**
   * Clear singletons instances cache.
   * When singleton will be required new instance will be created and factory will be executed once more with new dependencies.
   * Helpful when some service is replaced and cached dependant should be created once more.
   *
   * @param resetParent false by default.
   */
  reset(resetParent?: boolean): IDIContainer<TServices>;

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
    Keys extends (
      | OptionalDependencySkipKey
      | TContainerKey
      | Getter<TServices>
    )[]
  >(
    callable: TCallable,
    options?: InjecuteOptions<TContainerKey, Keys> | [...Keys]
  ): CallableResult<TCallable>;
}
