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
export type Argument = { name: string; required: boolean };
export type Resolver<TServices> = <Key extends keyof TServices>(
  name: Key
) => TServices[Key] | undefined;
export type Factory<K, TServices> = K extends keyof TServices
  ? Callable<ValueOf<TServices>[], TServices[K]>
  : Callable<ValueOf<TServices>[], any>;

export type GetOptions = { allowUnresolved: boolean };

type DependenciesTypesEntry<
  TServices extends Record<string, any>,
  K extends keyof TServices
> = K extends OptionalDependencySkipKey ? undefined : TServices[K];
export const optionalDependencySkipKey = 'undefined' as const;
export type OptionalDependencySkipKey = typeof optionalDependencySkipKey;
export type DependenciesTypes<
  TServices extends Record<string, any>,
  Keys extends readonly (keyof TServices)[] = readonly (keyof TServices)[]
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

export type UseExplicitContainerKeys<
  TServices extends Record<K, V>,
  TResult extends any,
  K extends keyof TServices = keyof TServices,
  V extends TServices[K] = TServices[K]
> = <Keys extends K[]>(
  keys: [...Keys],
  callable: Callable<DependenciesTypes<TServices, Keys>, TResult>
) => TResult;

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

export type InjecuteOptions<
  TContainerKey,
  Keys extends readonly (OptionalDependencySkipKey | TContainerKey)[]
> = {
  argumentsKey?: TContainerKey | undefined;
  isConstructor?: boolean;
  argumentsNames?: [...Keys];
};

export type MapOf<T> = Map<keyof T, ValueOf<T>> & {
  get<K extends keyof T>(k: K): T[K];
  set<K extends ArgumentsKey, V extends any>(
    k: K,
    v: V
  ): MapOf<T & Record<K, V>>;
};

export interface IDIContainer<
  TServices extends Record<ArgumentsKey, any>,
  TContainerKey extends keyof TServices = keyof TServices
> {
  readonly resolveArguments: ArgumentsResolver;

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
   * @param options {{ override: boolean }}
   */
  addInstance<
    K extends string | symbol,
    NewServices extends TServices & { [k in K]: TResult },
    TResult extends any,
    C extends IDIContainer<NewServices>
  >(
    this: unknown,
    name: Exclude<K, OptionalDependencySkipKey & TContainerKey>,
    instance: TResult,
    options?: { override: boolean }
  ): C;

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
    this: unknown,
    name: Exclude<K, Keys[number]>,
    factory: TCallable,
    options?:
      | {
          override?: boolean;
          isConstructor?: boolean;
          explicitArgumentsNames?: [...Keys];
          beforeResolving?: (k: K) => void;
          afterResolving?: (k: K, instance: TResult) => void;
        }
      | [...Keys]
  ): C;

  /**
   * Once created instance will be returned for each service request
   * @param name
   * @param factory function or constructor
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
    this: unknown,
    name: Exclude<K, Keys[number]>,
    factory: TCallable,
    options?:
      | {
          override?: boolean;
          isConstructor?: boolean;
          explicitArgumentsNames?: [...Keys];
          beforeResolving?: (k: K) => void;
          afterResolving?: (k: K, instance: TResult) => void;
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
  ): IDIContainer<TServices & { [k in K]: T }>;

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
   * Creates child container.
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
    Out extends In & Added = In & Added
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
    Keys extends (OptionalDependencySkipKey | TContainerKey)[]
  >(
    callable: TCallable,
    options?: InjecuteOptions<TContainerKey, Keys> | [...Keys]
  ): CallableResult<TCallable>;
}
