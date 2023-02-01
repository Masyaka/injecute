import {
  Argument,
  ArgumentsKey,
  ArgumentsResolver,
  Callable,
  CallableResult,
  Constructor,
  DependenciesTypes,
  Empty,
  Func,
  IDIContainer,
  IDIContainerExtension,
  optionalDependencySkipKey,
  OptionalDependencySkipKey,
  Resolver,
  ValueOf,
} from './types';
import { argumentsNamesToArguments, firstResult } from './utils';

export class CircularDependencyError extends Error {
  constructor(stack: ArgumentsKey[]) {
    const circularStackDescription = stack
      .map((k) => (k === stack[stack.length - 1] ? `*${k.toString()}*` : k))
      .join(' -> ');
    super(`Circular dependency detected ${circularStackDescription}.`);
  }
}

/**
 * Dependency Injection container
 */
export class DIContainer<
  TParentServices extends Record<ArgumentsKey, any> = Empty,
  TServices extends TParentServices & Record<ArgumentsKey, any> = TParentServices & Empty,
  TContainerKey extends keyof TServices = keyof TServices,
> implements IDIContainer<TServices, TContainerKey> {
  constructor(protected parentContainer?: IDIContainer<TParentServices>) {
    this.addArgumentsResolver(DIContainer.resolveArgumentsFromCache);
  }

  public readonly arguments: { [key in keyof TServices]?: Argument[] } = {};
  protected factories: {
    [key in keyof TServices]?: {
      callable: Callable<ValueOf<TServices>[], TServices[key]>,
      isConstructor?: boolean
    }
  } = {};
  protected instances: { [key in keyof TServices]?: TServices[key] } = {};
  private readonly argumentsResolvers: ArgumentsResolver[] = [];

  static readonly resolveArgumentsFromCache: ArgumentsResolver = function (this, _, argumentsKey) {
    if (!argumentsKey) return;
    return this.arguments[argumentsKey];
  };

  /**
   * true if services with such name is registered, false otherwise
   * @param name
   */
  has(name: TContainerKey | ArgumentsKey): boolean {
    return !!(this.factories[name as TContainerKey] || this.instances[name as TContainerKey]);
  }

  /**
   * Adds existing instance to collection
   * @param name
   * @param instance
   * @param options {{ override: boolean }}
   */
  addInstance<
    K extends ArgumentsKey,
    NewServices extends { [k in K]: TResult } & TServices,
    TResult extends any,
    C extends IDIContainer<NewServices>,
  >(name: Exclude<K, OptionalDependencySkipKey>, instance: TResult, options?: { override: boolean }): C {
    this.addSingleton(
      name,
      () => instance,
      { override: options?.override, isConstructor: false, explicitArgumentsNames: [] },
    );
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
    NewServices extends { [k in K]: TResult } & TServices,
  >(
    name: Exclude<K, OptionalDependencySkipKey>,
    factory: TCallable,
    options?:
      | {
      override?: boolean;
      isConstructor?: boolean;
      explicitArgumentsNames?: [...Keys];
    }
      | [...Keys],
  ): C {
    const optionsIsArray = Array.isArray(options);
    const override = !optionsIsArray && !!options?.override;
    const explicitArgumentsNames = optionsIsArray ? options : options?.explicitArgumentsNames;
    this.validateAdd(name, factory, override);
    this.resolveAndCacheArguments(factory, name, explicitArgumentsNames);
    this.factories[name] = {
      callable: factory as Callable<any[], NewServices[typeof name]>,
      isConstructor: !optionsIsArray ? options?.isConstructor : undefined,
    };
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
    NewServices extends { [k in K]: TResult } & TServices,
  >(
    name: Exclude<K, OptionalDependencySkipKey>,
    factory: TCallable,
    options?:
      | {
      override?: boolean;
      isConstructor?: boolean;
      explicitArgumentsNames?: [...Keys];
    }
      | [...Keys],
  ): C {

    const optionsIsArray = Array.isArray(options);
    const explicitArgumentsNames = optionsIsArray ? options : options?.explicitArgumentsNames;
    const override = !optionsIsArray && !!options?.override;
    this.validateAdd(name, factory, override);
    this.resolveAndCacheArguments(factory, name, explicitArgumentsNames);
    this.factories[name] = {
      callable: () => {
        const instance = this.injecute(factory, {
          argumentsKey: name,
          argumentsNames: explicitArgumentsNames,
          isConstructor: !optionsIsArray ? options?.isConstructor : undefined,
        }) as NewServices[typeof name];
        this.instances[name] = instance;
        return instance;
      },
      isConstructor: false,
    };
    return this as any;
  }

  // TODO: Fix ObjectKeyOfType<TServices, T> to constraint allowed aliases for type
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
  addAlias<T extends TServices[A], K extends ArgumentsKey, A extends TContainerKey>(
    name: Exclude<K, OptionalDependencySkipKey>,
    aliasTo: A,
  ): IDIContainer<{ [k in K]: T } & TServices> {
    return this.addTransient(name, () => this.get(aliasTo), []);
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
   */
  get<Key extends TContainerKey = TContainerKey, T extends any = TServices[Key]>(serviceName: Key): T {
    const instance = this.safeGet(serviceName);

    if (instance) {
      return instance;
    }

    throw new Error(`No service registered for "${String(serviceName)}" key.`);
  }

  //  ArgumentsResolver
  public addArgumentsResolver(ar: ArgumentsResolver): DIContainer<TServices> {
    this.argumentsResolvers.push(ar);
    return this;
  }

  readonly resolveArguments: ArgumentsResolver = (fn, argumentsKey) => {
    for (const argumentsResolver of this.argumentsResolvers) {
      const args = argumentsResolver.call(this as IDIContainer, fn, argumentsKey);
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
  bind<TResult extends any, Keys extends (OptionalDependencySkipKey | TContainerKey)[]>(
    keys: [...Keys],
    callable: Callable<DependenciesTypes<TServices, Keys>, TResult>,
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
  fork<T extends TServices = TServices>(): IDIContainer<T> {
    const child = new DIContainer<T>(this as IDIContainer<TServices>);
    child.argumentsResolvers.length = 0;
    this.argumentsResolvers.forEach((ar) => child.addArgumentsResolver(ar));
    return child as IDIContainer<T>;
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
  extend<In extends TServices, Added extends Record<ArgumentsKey, any>, Out extends In & Added>(
    extensionFunction: IDIContainerExtension<In, Added, Out>,
  ): IDIContainer<Out> {
    const c = this as IDIContainer<TServices>;
    return extensionFunction.apply(c, [c]);
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
    TCallable extends Callable<DependenciesTypes<TServices, Keys>, TResult>,
    Keys extends (OptionalDependencySkipKey | TContainerKey)[],
    TResult,
  >(
    callable: TCallable,
    options?:
      | {
      argumentsKey?: TContainerKey | ArgumentsKey | undefined;
      isConstructor?: boolean;
      argumentsNames?: [...Keys];
    }
      | [...Keys],
  ): CallableResult<TCallable> {
    const optionsIsArray = Array.isArray(options);
    const argumentsNames = optionsIsArray ? options : options?.argumentsNames;
    const argumentsKey = !optionsIsArray ? options?.argumentsKey : undefined;
    const args = this.resolveAndCacheArguments(callable, argumentsKey, argumentsNames);

    if (!args) {
      throw new Error(`Not resolved arguments for ${String(argumentsKey)} "${callable.toString().substring(0, 50)}"`);
    }

    const dependencies = this.mapAgrsToInstances(args);

    const useNewKeyword = !optionsIsArray && (typeof options?.isConstructor === 'boolean')
      ? options.isConstructor
      : !!callable.prototype?.constructor;

    if (useNewKeyword) {
      const constructor = callable as Constructor<any, any>;
      return new constructor(...(dependencies as ConstructorParameters<typeof constructor>));
    } else {
      const func = callable as Func<any, any>;
      return func(...(dependencies as Parameters<typeof func>));
    }
  }

  protected assertNotRegistered(name: TContainerKey | ArgumentsKey) {
    if (this.has(name)) {
      throw new Error(`Factory or instance with name "${String(name)}" already registered`);
    }
  }

  protected resolveInstance: Resolver<TServices> = (name) => {
    return this.instances[name];
  };

  // TODO: change signature to accept ArgumentsResolverCreator <T>(this: DIContainer<TServices>):
  //  DIContainer<TServices & T> =>

  protected resolveFromFactory: Resolver<TServices> = (name) => {
    const factory = this.factories[name];
    if (factory) {
      return this.injecute(factory.callable as Callable<any, TServices[typeof name]>, {
        argumentsKey: name as any,
        isConstructor: factory.isConstructor,
      });
    }
  };

  protected resolveFromParent: Resolver<TServices> = (name) => {
    return this.parentContainer?.safeGet(name);
  };

  readonly safeGet: Resolver<TServices> = firstResult([
    this.resolveInstance,
    this.resolveFromFactory,
    this.resolveFromParent,
  ]);

  protected assertFactoryIsAcceptable(factory: any, name: TContainerKey | ArgumentsKey) {
    if (!factory) {
      throw new Error(`Falsy factory or class constructor added for "${String(name)}" key`);
    }
  }

  protected assertKeyIsValid(k: unknown): asserts k is Exclude<any, OptionalDependencySkipKey> {
    if (k === optionalDependencySkipKey) {
      throw new Error(`"${optionalDependencySkipKey}" key is not allowed as key for service.`);
    }
  }

  private resolveAndCacheArguments(
    fn: Callable<any, any>,
    argumentsKey?: ArgumentsKey,
    argumentsNames?: (OptionalDependencySkipKey | TContainerKey)[],
  ) {
    const args: Argument[] | undefined = argumentsNames
      ? argumentsNamesToArguments(argumentsNames as string[])
      : (this as IDIContainer).resolveArguments(fn as Callable<any, any>, argumentsKey);

    if (args && argumentsKey && !this.arguments[argumentsKey]) {
      this.cacheArguments(args, argumentsKey);
    }

    return args;
  }

  private mapAgrsToInstances(args: Argument[]) {
    return args.map((arg) =>
      arg.required ? this.get(arg.name as TContainerKey) : this.safeGet(arg.name as TContainerKey),
    );
  }

  private ensureNoCirculars(key: ArgumentsKey, stack: ArgumentsKey[] = []): ArgumentsKey[][] {
    // todo: use same mechanism to build dep tree
    const args = this.arguments[key];
    if (!args) return [stack];
    return args.flatMap((a) => {
      const newStack = [...stack, a.name];
      if (stack.includes(a.name)) {
        throw new CircularDependencyError(newStack);
      }
      return this.ensureNoCirculars(a.name, newStack);
    });
  }

  private cacheArguments(args: Argument[], argumentsKey: TContainerKey | ArgumentsKey) {
    this.arguments[argumentsKey] = args;
    this.ensureNoCirculars(argumentsKey);
    return args;
  }

  private validateAdd(name: Exclude<ArgumentsKey, OptionalDependencySkipKey>, factory: Callable<any, any>, override?: boolean) {
    this.assertKeyIsValid(name);
    this.assertFactoryIsAcceptable(factory, name);
    if (!override) {
      this.assertNotRegistered(name);
    }
  }
}

/**
 * TODO: Support child container first resolving strategy.
 * It can be done by collecting vertical projection of existing instances and factories.
 * Steps:
 * 1) Collect all needed dependencies. Instances (i) and factories (f) independent.
 * 2) Resolve each dependency independently starting from current container and moving to parent if not resolved in current.
 * 3) Run factories (f) to get missing instances
 * 4) Instantiate requested service using ready to use instances (i).
 *
 * containers | dep1  | dep2  | dep3  | dep4
 * --------------------------------------
 * root       |       |   f   |       |
 * child1     |   i   |   .   |   f   |
 * child2     |   .   |   .   |   .   |   i
 */

/**
 * TODO: add external dynamic services config.
 * It can be implemented by adding new arguments resolvers
 * .yml or .json like this:
 * @example
 * ```json
 * {
 *   winstonLogger: ['devLoggerTransports'] // use dev transports for winstonLogger
 *   logger: 'winstonLogger', // use winston as default logger
 *   notificationService: 'slackNotificationService' // use slack service as notificationService
 * }
 * ```
 */

/**
 * TODO: Add decorators services registering strategy
 */
