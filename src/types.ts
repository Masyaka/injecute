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

export type PromisedProperties<T extends Record<ArgumentsKey, any>> = {
  [K in keyof T]: T[K] extends Promise<any> ? T[K] : Promise<T[K]>;
};

export type CallableResult<TCallable> = TCallable extends Constructor<any, any>
  ? InstanceType<TCallable>
  : TCallable extends Func<any, any>
  ? ReturnType<TCallable>
  : unknown;

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

export type Dependency<TServices extends Record<string, any>> =
  | OptionalDependencySkipKey
  | keyof TServices
  | (() => TServices[keyof TServices])
  | Factory<TServices, keyof TServices>;

export type KeysToTypes<
  Keys extends readonly Dependency<TServices>[],
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

export type ResolversMapKeys<
  Keys extends readonly (
    | readonly [ArgumentsKey, ArgumentsKey]
    | ArgumentsKey
  )[],
> = Keys extends [
  infer Key,
  ...infer Rest extends readonly (
    | [ArgumentsKey, ArgumentsKey]
    | ArgumentsKey
  )[],
]
  ? [
      Key extends ArgumentsKey
        ? [Key, Key]
        : Key extends [ArgumentsKey, ArgumentsKey]
        ? Key
        : never,
      ...ResolversMapKeys<Rest>,
    ]
  : [];

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
  argumentsKey: ArgumentsKey,
) => () => TServices[ArgumentsKey] | undefined;

export type IDIContainerExtension<
  In extends Record<string, any>,
  Added extends Record<string, any>,
  Out extends In & Added = In & Added,
> = (this: IDIContainer<In>, c: IDIContainer<In>) => IDIContainer<Out>;

export type ContainerServices<C extends IDIContainer<any, any>> =
  C extends IDIContainer<infer O, infer P> ? Flatten<O & P> : never;

export type ContainerParentServices<C extends IDIContainer<any, any>> =
  C extends IDIContainer<any, infer P> ? P : never;

export type ContainerOwnServices<C extends IDIContainer<any, any>> =
  C extends IDIContainer<infer O, any> ? O : never;

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
  argumentsNames?: [...Keys];
};

export type WithNamespace<
  TNamespace extends string,
  TNamespaceServices extends Record<ArgumentsKey, any>,
> = {
  [K in TNamespace]: IDIContainer<
    Record<
      ArgumentsKey,
      any
    > /* should be the TNamespaceServices, but needed to be optimized inferred type */
  >;
} & {
  [K in keyof TNamespaceServices as K extends string
    ? `${TNamespace}.${K}`
    : never]: TNamespaceServices[K];
};

/**
 * Actually the Map but...
 */
export interface MapOf<T> extends Map<keyof T, ValueOf<T>> {
  get<K extends keyof T>(k: K): T[K];

  set<K extends keyof T, V extends T[K]>(k: K, v: V): this;
}

export type Merge<T1, T2> = Flatten<T1 & T2>;
export type Flatten<T> = { [k in keyof T]: T[k] } & {};

/**
 * How factory was added
 */
export type FactoryType =
  | 'singleton'
  | 'transient'
  | 'instance'
  | 'alias'
  | 'namespace-pass-through'
  | 'reverse-namespace-replacement';

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
  reset: { resetParent: boolean; container: C; keys?: ArgumentsKey[] };
  get: { key: ArgumentsKey; value: any; container: C };
  produce: { key: ArgumentsKey; value: any; container: C };
};

export interface IDIContainer<
  TOwnServices extends Record<ArgumentsKey, any>,
  TParentServices extends Record<ArgumentsKey, any> = Empty,
> {
  addEventListener<E extends keyof Events<this>>(
    e: E,
    handler: (
      e: Events<IDIContainer<TOwnServices & TParentServices>>[E],
    ) => void,
  ): this;

  removeEventListener<E extends keyof Events<this>>(
    e: E,
    handler: (
      e: Events<IDIContainer<TOwnServices & TParentServices>>[E],
    ) => void,
  ): this;

  /**
   * true if services with such key is registered, false otherwise
   * @param name
   */
  has(name: keyof (TOwnServices & TParentServices) | string): boolean;

  getParent(): IDIContainer<TParentServices> | undefined;

  /**
   * keys of current container with parent keys if exists
   */
  get keys(): ArgumentsKey[];

  /**
   * keys of current container without parent keys
   */
  get ownKeys(): ArgumentsKey[];

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
  ): IDIContainer<TOwnServices & { [k in K]: TResult }, TParentServices>;

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
    TCallable extends Callable<
      KeysToTypes<Keys, TOwnServices & TParentServices>,
      any
    >,
    Keys extends (
      | OptionalDependencySkipKey
      | keyof (TOwnServices & TParentServices)
      | (() => any)
    )[],
    TResult extends CallableResult<TCallable>,
  >(
    this: unknown,
    name: K,
    factory: TCallable,
    options?:
      | {
          replace?: boolean;
          dependencies: [...Keys];
          beforeResolving?: () => void;
          afterResolving?: (instance: TResult) => void;
          beforeReplaced?: () => TCallable | void;
        }
      | [...Keys],
  ): IDIContainer<TOwnServices & { [k in K]: TResult }, TParentServices>;

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
    TCallable extends Callable<
      KeysToTypes<Keys, TOwnServices & TParentServices>,
      any
    >,
    Keys extends (
      | OptionalDependencySkipKey
      | keyof (TOwnServices & TParentServices)
      | (() => any)
    )[],
    TResult extends CallableResult<TCallable>,
  >(
    this: unknown,
    name: K,
    factory: TCallable,
    options?:
      | {
          replace?: boolean;
          dependencies: [...Keys];
          beforeResolving?: () => void;
          afterResolving?: (instance: TResult) => void;
          beforeReplaced?: () => TCallable | void;
        }
      | [...Keys],
  ): IDIContainer<TOwnServices & { [k in K]: TResult }, TParentServices>;

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
    TResult extends (TOwnServices & TParentServices)[A],
    K extends ArgumentsKey,
    A extends keyof (TOwnServices & TParentServices),
  >(
    name: K,
    aliasTo: A,
  ): IDIContainer<TOwnServices & { [k in K]: TResult }, TParentServices>;

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
    Key extends keyof (TOwnServices & TParentServices),
    O extends GetOptions,
    T extends any = (TOwnServices & TParentServices)[Key],
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
    Keys extends readonly (
      | OptionalDependencySkipKey
      | keyof (TOwnServices & TParentServices)
    )[],
  >(
    keys: [...Keys],
    callable: Callable<
      KeysToTypes<Keys, TOwnServices & TParentServices>,
      TResult
    >,
  ): () => TResult;

  /**
   * Create getter for specified key
   * @param key
   */
  createResolver<K extends keyof (TOwnServices & TParentServices)>(
    key: K,
  ): () => (TOwnServices & TParentServices)[K];

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
  fork<
    T extends TOwnServices & TParentServices = TOwnServices & TParentServices,
  >(options?: {
    skipMiddlewares?: boolean;
    skipResolvers?: boolean;
  }): IDIContainer<{}, T>;

  /**
   * Moves all factories, but not caches from parent containers to current level.
   * Will throw if keys intersection met and `onKeyIntersection` recovery callback not provided.
   */
  flatten(options?: {
    fork?: boolean;
    onKeyIntersection?: <K extends keyof (TOwnServices & TParentServices)>(
      k: K,
    ) => Resolve<(TOwnServices & TParentServices)[K]>;
  }): IDIContainer<TOwnServices & TParentServices>;

  /**
   * Adopts callback result container services.
   * Provided fork of current container can be used or new created container.
   * Current container will have access to namespace services with namespace prefix.
   * For cases when you want to avoid keys intersection conflict.
   *
   * @param namespace
   * @param extension
   */
  namespace<
    TNamespaceServices extends Flatten<
      ContainerOwnServices<ReturnType<TExtension>>
    >,
    TExtension extends (
      c: IDIContainer<{}, TOwnServices & TParentServices>,
    ) => IDIContainer<any, TOwnServices & TParentServices>,
    TNamespace extends string,
  >(
    namespace: TNamespace,
    extension: TExtension,
  ): IDIContainer<
    TOwnServices & WithNamespace<TNamespace, TNamespaceServices>,
    TParentServices
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
  extend<S extends TOwnServices, T extends Record<ArgumentsKey, any>>(
    extensionFunction: (
      container: IDIContainer<S, TParentServices>,
    ) => IDIContainer<T, TParentServices>,
  ): IDIContainer<TOwnServices & T, TParentServices>;

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
  reset(options?: {
    resetParent?: boolean;
    keys?: (keyof (TOwnServices & TParentServices))[];
  }): IDIContainer<TOwnServices, TParentServices>;

  call<
    FnKey extends KeyForValueOfType<
      TOwnServices & TParentServices,
      (...p: any[]) => any
    >,
    Fn extends (TOwnServices & TParentServices)[FnKey],
  >(
    key: FnKey,
    params: ArgumentsTypes<Fn>,
  ): ReturnType<Fn>;

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
    TCallable extends Callable<
      KeysToTypes<Keys, TOwnServices & TParentServices>,
      TResult
    >,
    Keys extends (
      | OptionalDependencySkipKey
      | keyof (TOwnServices & TParentServices)
      | Resolve<
          (TOwnServices & TParentServices)[keyof (TOwnServices &
            TParentServices)]
        >
    )[],
  >(
    callable: TCallable,
    options?:
      | InjecuteOptions<keyof (TOwnServices & TParentServices), Keys>
      | [...Keys],
  ): CallableResult<TCallable>;
}
