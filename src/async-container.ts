import { DIContainer } from './container.ts';
import { InjecuteError } from './errors.ts';
import type {
  AsyncNamespacedServices,
  AsyncServiceRegistry,
  ContainerEvents,
  Dependency,
  Factory,
  ForkOptions,
  GetOptions,
  InstanceOptions,
  Middleware,
  Produced,
  RegistrationOptions,
  ResetOptions,
  ServiceKey,
  SingletonOptions,
} from './types.ts';

/** Runs `run`, turning a synchronous throw into a rejected promise. */
function toPromise<T>(run: () => T): Promise<Awaited<T>> {
  try {
    return Promise.resolve(run());
  } catch (error) {
    return Promise.reject(error);
  }
}

const AsyncDIContainerClass = class AsyncDIContainer extends DIContainer<any> {
  protected override invokeFactory(
    factory: (...args: any[]) => unknown,
    args: unknown[],
  ): unknown {
    return Promise.all(args).then((resolved) =>
      super.invokeFactory(factory, resolved),
    );
  }

  override get(key: ServiceKey, options?: GetOptions): Promise<any> {
    return toPromise(() => super.get(key, options));
  }

  override injecute(factory: any, dependencies: any[]): any {
    return toPromise(() => super.injecute(factory, dependencies));
  }

  override call(
    key: ServiceKey,
    args: unknown[],
    thisArg: unknown = undefined,
  ): Promise<any> {
    return this.get(key).then((value: unknown) => {
      if (typeof value !== 'function') {
        throw new InjecuteError(
          'INJECUTE_NOT_A_FUNCTION',
          `Service "${String(key)}" is not a function, so it cannot be called.`,
        );
      }
      return value.apply(thisArg, args);
    });
  }
};

/**
 * A container for async services: every dependency is awaited before a factory runs, so factories
 * receive resolved values, and every resolution (`get`, `call`, `injecute`) returns a promise.
 *
 * Its service types are the resolved types: a factory returning `Promise<Pool>` registers `Pool`,
 * dependents receive a `Pool`, and `get()` returns `Promise<Pool>`. Singletons are created once, also
 * under concurrent `get()` calls; a failed creation is retried on the next resolution; `dispose()`
 * releases the resolved instances.
 *
 * Modules for it take an {@link AsyncServiceRegistry}; hand an {@link AsyncServiceProvider} to code that
 * only resolves services. The sync {@link ServiceRegistry} / {@link ServiceProvider} types don't accept
 * it, because their `get()` returns values, not promises.
 *
 * @example
 * ```ts
 * import { AsyncDIContainer } from 'injecute';
 *
 * const app = new AsyncDIContainer()
 *   .addSingleton('config', () => loadConfig()) // Promise<Config> → Config
 *   .addSingleton('db', (config) => connect(config.dbUrl), ['config']) // receives a Config
 *   .addSingleton('users', UserRepository, ['db']);
 *
 * const users = await app.get('users'); // UserRepository
 * await app.dispose();
 * ```
 */
export interface AsyncDIContainer<
  S extends object = {},
> extends AsyncServiceRegistry<S, S> {
  addSingleton<
    K extends ServiceKey,
    F extends Factory<D, S>,
    D extends Dependency<S>[] = [],
  >(
    key: K,
    factory: F,
    dependencies?: [...D] | SingletonOptions<[...D], Awaited<Produced<F>>>,
  ): AsyncDIContainer<S & { [P in K]: Awaited<Produced<F>> }>;

  addTransient<
    K extends ServiceKey,
    F extends Factory<D, S>,
    D extends Dependency<S>[] = [],
  >(
    key: K,
    factory: F,
    dependencies?: [...D] | RegistrationOptions<[...D]>,
  ): AsyncDIContainer<S & { [P in K]: Awaited<Produced<F>> }>;

  addInstance<K extends ServiceKey, T>(
    key: K,
    value: T,
    options?: InstanceOptions<Awaited<T>>,
  ): AsyncDIContainer<S & { [P in K]: Awaited<T> }>;

  addAlias<K extends ServiceKey, T extends keyof S>(
    key: K,
    target: T,
  ): AsyncDIContainer<S & { [P in K]: S[T] }>;

  namespace<const N extends string, NA extends object, Req extends object = S>(
    name: N,
    extension: [S] extends [Req]
      ? (
          registry: AsyncServiceRegistry<Req, {}>,
        ) => AsyncServiceRegistry<any, NA> | AsyncDIContainer<NA>
      : {
          'injecute: extension requires services that are not registered': Exclude<
            keyof Req,
            keyof S
          >;
        },
  ): AsyncDIContainer<S & AsyncNamespacedServices<N, NA>>;

  extend<EA extends object, Req extends object = S>(
    extension: [S] extends [Req]
      ? (
          registry: AsyncServiceRegistry<Req, {}>,
        ) => AsyncServiceRegistry<any, EA> | AsyncDIContainer<EA>
      : {
          'injecute: extension requires services that are not registered': Exclude<
            keyof Req,
            keyof S
          >;
        },
  ): AsyncDIContainer<S & EA>;

  /**
   * Adds a middleware around every resolution started from this container and its forks. In an async
   * container `next()` may return a promise (for services created by a factory).
   */
  use(middleware: Middleware): this;

  /** Removes a middleware added with `use()`. */
  unuse(middleware: Middleware): this;

  /**
   * Subscribes to container events. In an async container the `value` of `get` and `produce` events
   * may be a promise.
   */
  addEventListener<E extends keyof ContainerEvents>(
    event: E,
    handler: (event: ContainerEvents[E]) => void,
  ): this;

  /** Removes a listener added with `addEventListener()`. */
  removeEventListener<E extends keyof ContainerEvents>(
    event: E,
    handler: (event: ContainerEvents[E]) => void,
  ): this;

  /** Creates a child container; see `DIContainer.fork()`. Forks of an async container are async. */
  fork(options?: ForkOptions): AsyncDIContainer<S>;

  /** Clears cached instances (all, or `keys`), so the next resolution creates them again. */
  reset(options?: ResetOptions<S>): this;

  /** Disposes every instance this container owns, dependents first; see `DIContainer.dispose()`. */
  dispose(): Promise<void>;

  /** Same as `dispose()`; enables `await using container = …`. */
  [Symbol.asyncDispose](): Promise<void>;
}

/**
 * Creates an {@link AsyncDIContainer}. Forks keep the async behaviour, and
 * `container instanceof AsyncDIContainer` works.
 *
 * @example
 * ```ts
 * const app = new AsyncDIContainer().addSingleton('db', () => connect(url));
 * const db = await app.get('db');
 * ```
 */
export const AsyncDIContainer: {
  new (): AsyncDIContainer<{}>;
  readonly prototype: AsyncDIContainer<any>;
} = AsyncDIContainerClass as unknown as {
  new (): AsyncDIContainer<{}>;
  readonly prototype: AsyncDIContainer<any>;
};
