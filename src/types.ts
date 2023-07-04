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
export type Callable<TParams extends readonly any[], TResult> = Func<
  TParams,
  TResult
>;
export type CallableResult<TCallable> = TCallable extends Constructor<any, any>
  ? InstanceType<TCallable>
  : TCallable extends Func<any, any>
  ? ReturnType<TCallable>
  : unknown;
export type Argument =
  | { name: ArgumentsKey; required: boolean }
  | { getter: () => any };
export type Factory<K, TServices> = K extends keyof TServices
  ? Callable<ValueOf<TServices>[], TServices[K]>
  : Callable<ValueOf<TServices>[], any>;

/**
 * Narrows type `O` to keys where values of specific type `T`
 * @example
 * ```
 * type X = ValuesOfType<{ x: 'a', y: 1  }, string>;
 * // { x: 'a' }
 * ```
 */
export type ValuesOfType<O, T> = {
  [K in keyof O as O[K] extends T ? K : never]: O[K];
};

/**
 * Keys of type `O` where values is the `T`
 * @example
 * ```
 * type X = KeyForValueOfType<{ x: 'a', y: 1, z: string  }, string>;
 * // 'x' | 'z'
 * ```
 */
export type KeyForValueOfType<O, T> = keyof ValuesOfType<O, T>;

export type ArgumentsTypes<C extends Callable<any[], any>> = C extends Callable<
  infer D,
  any
>
  ? D
  : never;

/**
 * Suitable keys of record for function arguments
 * @example
 * ```
 * type X = Dependencies<(first: number, second: string) => any, { x: 1, y: '2' , z: 'z', s: Symbol}>
 *   // ['x', 'y' | 'z']
 * ```
 */
export type Dependencies<
  C extends Callable<any[], any>,
  TServices extends Record<ArgumentsKey, any>,
  A extends ArgumentsTypes<C> = ArgumentsTypes<C>,
> = TypesToKeys<A, TServices>;

export type TypesToKeys<
  Tup extends readonly any[],
  TServices extends Record<ArgumentsKey, any>,
> = Tup extends readonly [infer H, ...infer R extends readonly any[]]
  ? [KeyForValueOfType<TServices, H> | (() => H), ...TypesToKeys<R, TServices>]
  : [];

export type KeysToTypes<
  Keys extends readonly (
    | (() => any)
    | OptionalDependencySkipKey
    | keyof TServices
  )[],
  TServices extends Record<ArgumentsKey, any>,
> = Keys extends readonly [
  infer Head extends any,
  ...infer Rest extends readonly any[],
]
  ? [
      Head extends () => any
        ? ReturnType<Head>
        : Head extends OptionalDependencySkipKey
        ? undefined
        : Head extends ArgumentsKey
        ? TServices[Head]
        : never,
      ...KeysToTypes<Rest, TServices>,
    ]
  : [];

export type GetOptions = { allowUnresolved: boolean };

export type Resolve<T> = () => T;

export type Resolver<TServices> = <Key extends keyof TServices>(
  name: Key,
) => TServices[Key] | undefined;

export const optionalDependencySkipKey = 'undefined' as const;
export type OptionalDependencySkipKey = typeof optionalDependencySkipKey;

export type ArgumentsKey = string | symbol | number;

export type ArgumentsResolver = <
  TServices extends Record<ArgumentsKey, any>,
  C extends IDIContainer<TServices>,
>(
  this: C,
  fn: Callable<any, any>,
  argumentsKey?: ArgumentsKey,
) => Argument[] | undefined;

export type IDIContainerExtension<
  In extends Record<string, any>,
  Added extends Record<string, any>,
  Out extends In & Added = In & Added,
> = (this: IDIContainer<In>, c: IDIContainer<In>) => IDIContainer<Out>;

export type ContainerServices<C extends IDIContainer<any>> =
  C extends IDIContainer<infer S> ? S : never;

export type NamespaceServices<
  C extends IDIContainer<any>,
  N extends keyof ContainerServices<C>,
> = ContainerServices<C>[N] extends IDIContainer<any>
  ? ContainerServices<ContainerServices<C>[N]>
  : `${N extends string ? N : ''} is not a namespace container`;

export type InjecuteOptions<
  TContainerKey,
  Keys extends readonly (
    | OptionalDependencySkipKey
    | TContainerKey
    | Resolve<any>
  )[],
> = {
  argumentsKey?: TContainerKey | undefined;
  useNew?: boolean;
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
  T2 extends Record<string, unknown>,
> = {
  [K in keyof (T1 & T2)]: K extends keyof T2
    ? T2[K]
    : K extends keyof T1
    ? T1[K]
    : never;
};

/**
 * How factory was added
 */
export type FactoryType =
  | 'singleton'
  | 'transient'
  | 'instance'
  | 'alias'
  | 'namespace-pass-through';

export type Events<C extends IDIContainer<any>> = {
  add: { key: ArgumentsKey; replace: boolean; container: C };
  replace: {
    key: ArgumentsKey;
    container: C;
    replaced: {
      callable: Callable<any, any>;
      type: FactoryType;
    };
  };
  reset: { resetParent: boolean; container: C };
  get: { key: ArgumentsKey; value: any; container: C };
};

export interface IDIContainer<
  TServices extends Record<ArgumentsKey, any>,
> {
  addEventListener<E extends keyof Events<this>>(
    e: E,
    handler: (e: Events<IDIContainer<TServices>>[E]) => void,
  ): this;

  removeEventListener<E extends keyof Events<this>>(
    e: E,
    handler: (e: Events<IDIContainer<TServices>>[E]) => void,
  ): this;

  getArgumentsFor(argumentsKey: ArgumentsKey): Argument[] | undefined;

  /**
   * true if services with such key is registered, false otherwise
   * @param name
   */
  has(name: (keyof TServices) | string): boolean;

  get keys(): (keyof TServices)[];

  /**
   * Adds existing instance to collection
   * @param name
   * @param instance
   * @param options {{ replace: boolean }}
   */
  addInstance<K extends ArgumentsKey, TResult extends any>(
    name: Exclude<K, OptionalDependencySkipKey>,
    instance: TResult,
    options?: {
      replace: boolean;
    },
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
    TCallable extends Callable<KeysToTypes<Keys, TServices>, any>,
    Keys extends (OptionalDependencySkipKey | (keyof TServices) | (() => any))[],
    TResult extends CallableResult<TCallable>,
  >(
    this: unknown,
    name: Exclude<K, Keys[number] | OptionalDependencySkipKey>,
    factory: TCallable,
    options?:
      | {
          replace?: boolean;
          useNew?: boolean;
          dependencies?: [...Keys];
          beforeResolving?: (k: K) => void;
          afterResolving?: (k: K, instance: TResult) => void;
          beforeReplaced?: (k: K) => void;
        }
      | [...Keys],
  ): IDIContainer<Merge<TServices, Record<K, TResult>>>;

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
    TCallable extends Callable<KeysToTypes<Keys, TServices>, any>,
    Keys extends (OptionalDependencySkipKey | (keyof TServices) | (() => any))[],
    TResult extends CallableResult<TCallable>,
  >(
    this: unknown,
    name: Exclude<K, Keys[number] | OptionalDependencySkipKey>,
    factory: TCallable,
    options?:
      | {
          replace?: boolean;
          useNew?: boolean;
          dependencies?: [...Keys];
          beforeResolving?: (k: K) => void;
          afterResolving?: (k: K, instance: TResult) => void;
          beforeReplaced?: (k: K) => void;
        }
      | [...Keys],
  ): IDIContainer<Merge<TServices, Record<K, TResult>>>;

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
    A extends (keyof TServices),
  >(
    name: Exclude<K, OptionalDependencySkipKey | A>,
    aliasTo: A,
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
    Key extends (keyof TServices),
    O extends GetOptions,
    T extends any = TServices[Key],
  >(
    serviceName: Key,
    options?: O,
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
    Keys extends readonly (OptionalDependencySkipKey | (keyof TServices))[],
  >(
    keys: [...Keys],
    callable: Callable<KeysToTypes<Keys, TServices>, TResult>,
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
   *     .addSingleton('namespaceService', construct(NamespaceServiceClass), ['namespaceRequirement1', 'namespaceRequirement2'])
   * )
   * ```
   * @param key
   */
  createResolver<K extends (keyof TServices)>(key: K): () => TServices[K];

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
    TNamespace extends string,
    TExtension extends (p: {
      parent: IDIContainer<TServices>;
      namespace: TServices[TNamespace] extends IDIContainer<any>
        ? TServices[TNamespace]
        : IDIContainer<{}>;
    }) => IDIContainer<any>,
    TNamespaceServices extends ContainerServices<ReturnType<TExtension>>,
  >(
    namespace: TNamespace,
    extension: TExtension,
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
    Out extends Merge<In, Added> = Merge<In, Added>,
  >(
    extensionFunction: IDIContainerExtension<In, Added, Out>,
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
    TCallable extends Callable<KeysToTypes<Keys, TServices>, TResult>,
    Keys extends (
      | OptionalDependencySkipKey
      | (keyof TServices)
      | Resolve<TServices[keyof TServices]>
    )[],
  >(
    callable: TCallable,
    options?: InjecuteOptions<(keyof TServices), Keys> | [...Keys],
  ): CallableResult<TCallable>;
}
