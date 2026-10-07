import { createTag } from '../dependencies.ts';
import { InjecuteError } from '../errors.ts';
import { asyncDispose, isThenable, TAGGED_KEYS } from '../internal.ts';
import type {
  AsyncServiceProvider,
  ContainerServices,
  Produced,
  RegistrationInfo,
  ServiceKey,
  ServiceProvider,
  ServiceRegistry,
  Tag,
} from '../types.ts';

// ------------------------------------------------------------------------------------------ types

/**
 * The part of an `AbortSignal` the lifecycle uses, for environments whose types have no `AbortSignal`.
 * Any `AbortSignal` is one.
 *
 * @example
 * ```ts
 * const signal: AbortSignalLike = AbortSignal.timeout(25_000);
 * ```
 */
export interface AbortSignalLike {
  /** `true` once the signal has aborted. */
  readonly aborted: boolean;
  /** Why the signal aborted. */
  readonly reason: unknown;
  /** Subscribes to the `abort` event. */
  addEventListener(
    type: 'abort',
    listener: () => void,
    options?: { once?: boolean },
  ): void;
  /** Unsubscribes from the `abort` event. */
  removeEventListener(type: 'abort', listener: () => void): void;
}

/**
 * The signal an undo function receives: the global `AbortSignal` when your environment's types have
 * one (DOM or Node.js), otherwise {@link AbortSignalLike}.
 *
 * @example
 * ```ts
 * app.addSingleton(lifecycle.start('server'), (server) => {
 *   server.listen(8080);
 *   return (signal: LifecycleSignal) => server.close({ force: signal.aborted });
 * }, ['server']);
 * ```
 */
export type LifecycleSignal = typeof globalThis extends {
  AbortSignal: { prototype: infer S };
}
  ? S
  : AbortSignalLike;

/**
 * What a lifecycle hook produces: nothing, or a function that undoes it (or a promise of either).
 * The undo function receives the `signal` passed to `running.stop()`, aborted when stopping takes too
 * long.
 *
 * @example
 * ```ts
 * app.addSingleton(lifecycle.start('server'), (server): LifecycleHook => {
 *   server.listen(8080);
 *   return () => server.close();
 * }, ['server']);
 * ```
 */
export type LifecycleHook = void | ((signal: LifecycleSignal) => unknown);

/**
 * Lifecycle stages, made by {@link createLifecycle}: one {@link Tag} of {@link LifecycleHook} per stage.
 * `lifecycle.start('server')` is the key `'server:start'`: register a hook under it with `addSingleton`.
 * As tags, stages also work with `collect()`.
 *
 * @example
 * ```ts
 * const stages = createLifecycle(['migrate', 'init', 'start']);
 * stages.migrate('schema'); // 'schema:migrate'
 * ```
 */
export type Lifecycle<S extends string = string> = {
  readonly [P in S]: Tag<LifecycleHook, P>;
};

/**
 * The state of a {@link RunningLifecycle}.
 *
 * @example
 * ```ts
 * app.get('health').addCheck(() => running.state === 'started');
 * ```
 */
export type LifecycleState = 'started' | 'stopping' | 'stopped';

/**
 * Where a failure reported to `onError` happened.
 *
 * @example
 * ```ts
 * await startLifecycle(app, {
 *   onError: (error, { key, during }: LifecycleErrorContext) => logger.warn({ error, key, during }),
 * });
 * ```
 */
export interface LifecycleErrorContext {
  /** The hook the failure belongs to; missing for `dispose`. */
  readonly key?: ServiceKey;
  /**
   * `start`: another hook of a concurrent stage failed too; `rollback`: an undo function failed while
   * undoing a failed start; `dispose`: the container failed to dispose after a failed start.
   */
  readonly during: 'start' | 'rollback' | 'dispose';
}

/**
 * What `onHook` receives after each hook ran or was undone.
 *
 * @example
 * ```ts
 * await startLifecycle(app, {
 *   onHook: ({ key, action, ms, error }: LifecycleHookEvent) =>
 *     logger.info({ key, action, ms, failed: error !== undefined }),
 * });
 * ```
 */
export interface LifecycleHookEvent {
  /** The hook's key, e.g. `'Payments.consumer:start'`. */
  readonly key: ServiceKey;
  /** The hook's stage. */
  readonly stage: string;
  /** `start`: the hook ran (at startup); `undo`: its undo function ran (at stop or rollback). */
  readonly action: 'start' | 'undo';
  /** How long it took, in milliseconds. */
  readonly ms: number;
  /** Why it failed or didn't finish; missing when it succeeded. */
  readonly error?: unknown;
}

/**
 * Options of {@link startLifecycle}.
 *
 * @example
 * ```ts
 * const running = await startLifecycle(app, {
 *   lifecycle: stages, // createLifecycle(['migrate', 'init', 'start'])
 *   concurrent: ['init'],
 *   signal: AbortSignal.timeout(30_000),
 *   onError: (error) => logger.warn(error),
 * });
 * ```
 */
export interface StartLifecycleOptions<S extends string> {
  /** The stages to run, made by {@link createLifecycle}. Default: {@link lifecycle} (`init`, `start`, `ready`). */
  lifecycle?: Lifecycle<S>;
  /** Stages whose hooks run concurrently, or `true` for every stage. Default: `false` (one by one). */
  // `[S][S extends any ? 0 : never]` is `S` without inferring `S` from it (`NoInfer` before TS 5.4)
  concurrent?: boolean | readonly [S][S extends any ? 0 : never][];
  /**
   * Dispose the container after `running.stop()` and after a failed start. Default: `true`. Pass
   * `false` when something else disposes the container.
   */
  dispose?: boolean;
  /**
   * Aborts a start that takes too long: the runner stops waiting for the pending hooks, undoes what
   * ran (its undo functions receive the aborted signal and are waited for), disposes and rejects. A
   * hook that finishes later is undone when it does; while it runs, disposing continues in the
   * background.
   */
  signal?: LifecycleSignal;
  /**
   * Receives the failures of a failed start that come after the first one (which `startLifecycle()`
   * rejects with). Without it, they are dropped.
   */
  onError?: (error: unknown, context: LifecycleErrorContext) => void;
  /**
   * Called after each hook runs and after each undo function, with the time it took: for startup logs,
   * metrics and finding slow hooks.
   */
  onHook?: (event: LifecycleHookEvent) => void;
}

/**
 * Options of `running.stop()`.
 *
 * @example
 * ```ts
 * await running.stop({ signal: AbortSignal.timeout(25_000) });
 * ```
 */
export interface StopLifecycleOptions {
  /**
   * Passed to every undo function. Once it aborts, the runner gives each remaining step one turn of the
   * event loop instead of waiting for it: it calls the remaining undo functions with the aborted signal
   * (their cue to take the fast path), then disposes. Steps that don't finish in time are reported.
   */
  signal?: LifecycleSignal;
}

/**
 * A started lifecycle, returned by {@link startLifecycle}.
 *
 * @example
 * ```ts
 * const running = await startLifecycle(app);
 * console.log('started', running.hooks);
 * process.once('SIGTERM', () => running.stop().catch((error) => logger.error(error)));
 *
 * // in a test: stopped at the end of the block
 * await using test = await startLifecycle(app.fork({ isolated: true }));
 * ```
 */
export interface RunningLifecycle {
  /** `started`, then `stopping` and `stopped` once `stop()` is called. */
  readonly state: LifecycleState;
  /** The hook keys that ran, in the order they were started (for startup logs and tests). */
  readonly hooks: readonly ServiceKey[];
  /**
   * Runs the undo functions in reverse order (stage by stage, the last stage first), then disposes the
   * container (unless `dispose: false`). Returns the same promise when called again. Rejects with
   * `INJECUTE_DISPOSE_FAILED` when some of them failed (each undo failure is an `INJECUTE_UNDO_FAILED`
   * in `cause.errors`, with the hook's key in `path`); the others still ran.
   */
  stop(options?: StopLifecycleOptions): Promise<void>;
  /** Same as `stop()`; enables `await using running = await startLifecycle(app)`. */
  [Symbol.asyncDispose](): Promise<void>;
}

/** A container the lifecycle can run on. */
type LifecycleContainer = (ServiceProvider | AsyncServiceProvider) & {
  dispose(): Promise<void>;
};

/** Keys of stage `S` whose service type is not a {@link LifecycleHook}. */
type InvalidHookKeys<Services, S extends string> = {
  [K in keyof Services]-?: K extends `${string}:${S}`
    ? [Awaited<Services[K]>] extends [LifecycleHook]
      ? never
      : K
    : never;
}[keyof Services];

type CheckHooks<C, S extends string> = [
  InvalidHookKeys<ContainerServices<C>, S>,
] extends [never]
  ? unknown
  : {
      'injecute: lifecycle hooks must produce nothing or an undo function': InvalidHookKeys<
        ContainerServices<C>,
        S
      >;
    };

// ---------------------------------------------------------------------------------------- stages

const STAGES: unique symbol = Symbol('injecute.lifecycleStages');

const invalidOption = (message: string) =>
  new InjecuteError('INJECUTE_INVALID_OPTION', message);

/**
 * Defines lifecycle stages, in the order they run, and returns a tag per stage. Modules register hooks
 * under the stage keys with `addSingleton`; {@link startLifecycle} runs them stage by stage.
 *
 * Reusable modules use the default {@link lifecycle}. An app with its own stages passes the result to
 * `startLifecycle(app, { lifecycle })`.
 *
 * @throws {InjecuteError} `INJECUTE_INVALID_OPTION` when there are no stages, or a stage name is empty,
 * repeated, or contains `:` or `.`.
 *
 * @example
 * ```ts
 * export const stages = createLifecycle(['migrate', 'init', 'start', 'ready']);
 *
 * // a module
 * c.addSingleton(stages.migrate('schema'), (db) => migrate(db), ['db']);
 *
 * // the composition root
 * const running = await startLifecycle(app, { lifecycle: stages });
 * ```
 */
export function createLifecycle<const S extends readonly string[]>(
  stages: S,
): Lifecycle<S[number]> {
  if (stages.length === 0) throw invalidOption('A lifecycle needs a stage.');
  const result: Record<string, Tag<LifecycleHook>> = {};
  for (const stage of stages) {
    const tag = createTag(stage).of<LifecycleHook>(); // validates the name
    if (Object.hasOwn(result, stage)) {
      throw invalidOption(`Stage "${stage}" is listed twice.`);
    }
    result[stage] = tag;
  }
  Object.defineProperty(result, STAGES, { value: Object.freeze([...stages]) });
  return Object.freeze(result) as unknown as Lifecycle<S[number]>;
}

/**
 * The default stages, in order: `init` (wire contributions, migrate, warm up), `start` (begin accepting
 * work: listen, start consumers) and `ready` (announce: readiness probe, service discovery). Stopping
 * undoes them in reverse.
 *
 * @example
 * ```ts
 * const addPayments = (c: ServiceRegistry<{ bus: Bus }>) =>
 *   c
 *     .addSingleton('consumer', PaymentConsumer, ['bus'])
 *     .addSingleton(lifecycle.start('consumer'), (consumer) => {
 *       consumer.start();
 *       return () => consumer.stop();
 *     }, ['consumer']);
 * ```
 */
export const lifecycle: Lifecycle<'init' | 'start' | 'ready'> = createLifecycle(
  ['init', 'start', 'ready'],
);

function stagesOf(definition: unknown): readonly string[] {
  const stages = (definition as { [STAGES]?: readonly string[] } | undefined)?.[
    STAGES
  ];
  if (!stages) {
    throw invalidOption(
      'The `lifecycle` option must be created with createLifecycle().',
    );
  }
  return stages;
}

// ----------------------------------------------------------------------------------------- running

type Outcome<T> =
  | { readonly status: 'fulfilled'; readonly value: T }
  | { readonly status: 'rejected'; readonly reason: unknown }
  | { readonly status: 'aborted' };

const ABORTED: Outcome<never> = { status: 'aborted' };

/** One turn of the event loop. */
const tick = () =>
  new Promise<void>((resolve) =>
    (
      globalThis as unknown as {
        setTimeout(callback: () => void, ms: number): unknown;
      }
    ).setTimeout(resolve, 0),
  );

/**
 * Settles with the promise's outcome. Once the signal has aborted, the promise gets one more turn of
 * the event loop to settle (so a result that is already on its way isn't lost), then it is `aborted`.
 */
function waitFor<T>(
  promise: Promise<T>,
  signal: AbortSignalLike | undefined,
): Promise<Outcome<T>> {
  const settled = promise.then(
    (value): Outcome<T> => ({ status: 'fulfilled', value }),
    (reason: unknown): Outcome<T> => ({ status: 'rejected', reason }),
  );
  if (!signal) return settled;
  return new Promise((resolve) => {
    let done = false;
    const finish = (outcome: Outcome<T>) => {
      if (done) return;
      done = true;
      signal.removeEventListener('abort', onAbort);
      resolve(outcome);
    };
    const onAbort = () => void tick().then(() => finish(ABORTED));
    void settled.then(finish);
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Calls `run`, turning a synchronous throw into a rejected promise. */
function attempt<T>(run: () => T): Promise<Awaited<T>> {
  try {
    return Promise.resolve(run());
  } catch (error) {
    return Promise.reject(error);
  }
}

const describe = (value: unknown) =>
  value instanceof Error ? value.message : String(value);

type Undo = (signal: AbortSignalLike) => unknown;

interface Started {
  readonly key: ServiceKey;
  readonly undo?: Undo;
}

type Notify = (event: LifecycleHookEvent) => void;

const now = (): number =>
  (globalThis as { performance?: { now(): number } }).performance?.now() ??
  Date.now();

interface StageRun {
  readonly stage: string;
  readonly concurrent: boolean;
  readonly started: Started[];
}

interface Failure {
  readonly key?: ServiceKey;
  readonly error: unknown;
}

const neverAborted = (): AbortSignalLike =>
  new (
    globalThis as unknown as { AbortController: new () => { signal: unknown } }
  ).AbortController().signal as AbortSignalLike;

/**
 * Runs undo functions, the last stage first; collects failures instead of stopping at one. Each undo
 * receives `passed`; once `wait` has aborted, each gets one turn of the event loop instead of being
 * waited for.
 */
async function undoAll(
  stages: readonly StageRun[],
  passed: AbortSignalLike,
  signal: AbortSignalLike | undefined,
  notify: Notify,
): Promise<Failure[]> {
  const failures: Failure[] = [];
  const undoOne = async (stage: string, { key, undo }: Started) => {
    if (!undo) return;
    const begin = now();
    const failed = (error: unknown) => {
      failures.push({ key, error });
      notify({ key, stage, action: 'undo', ms: now() - begin, error });
    };
    let result: unknown;
    try {
      result = undo(passed);
    } catch (error) {
      return failed(undoFailed(key, error));
    }
    const outcome = await waitFor(Promise.resolve(result), signal);
    if (outcome.status === 'rejected') failed(undoFailed(key, outcome.reason));
    else if (outcome.status === 'aborted') {
      failed(
        new InjecuteError(
          'INJECUTE_UNDO_FAILED',
          `Undoing lifecycle hook "${String(key)}" did not finish before the signal aborted: ${describe(signal!.reason)}`,
          { path: [key], cause: signal!.reason },
        ),
      );
    } else notify({ key, stage, action: 'undo', ms: now() - begin });
  };
  for (const { stage, concurrent, started } of [...stages].reverse()) {
    if (concurrent)
      await Promise.all(started.map((entry) => undoOne(stage, entry)));
    else
      for (const entry of [...started].reverse()) await undoOne(stage, entry);
  }
  return failures;
}

/**
 * Disposes the container. Once the signal has aborted, it doesn't wait (beyond one turn of the event
 * loop): `dispose()` also waits for singletons still being created, such as a hook the signal gave up
 * on, and keeps going in the background.
 */
async function disposeContainer(
  container: LifecycleContainer,
  signal: AbortSignalLike | undefined,
): Promise<unknown[]> {
  const disposing = attempt(() => container.dispose());
  const outcome = await waitFor(disposing, signal);
  if (outcome.status === 'fulfilled') return [];
  if (outcome.status === 'aborted') {
    return [
      new InjecuteError(
        'INJECUTE_DISPOSE_FAILED',
        `Disposing the container did not finish before the signal aborted: ${describe(signal!.reason)}`,
        { cause: signal!.reason },
      ),
    ];
  }
  const error = outcome.reason;
  const cause = (error as { cause?: unknown }).cause;
  return error instanceof InjecuteError &&
    error.code === 'INJECUTE_DISPOSE_FAILED' &&
    cause instanceof AggregateError
    ? cause.errors
    : [error];
}

const undoFailed = (key: ServiceKey, error: unknown) =>
  new InjecuteError(
    'INJECUTE_UNDO_FAILED',
    `Undoing lifecycle hook "${String(key)}" failed: ${describe(error)}`,
    { path: [key], cause: error },
  );

const aborted = (key: ServiceKey, reason: unknown, ran: boolean) =>
  new InjecuteError(
    'INJECUTE_RESOLUTION_FAILED',
    `Lifecycle hook "${String(key)}" ${ran ? 'did not finish' : 'did not start'}: the signal aborted (${describe(reason)}).`,
    { path: [key], cause: reason },
  );

/**
 * The keys of the services under a tag, as `collect(tag)` resolves them in this container: registration
 * order, the root's first. (`keys` lists a fork's own keys first.)
 */
function tagged(container: LifecycleContainer, tag: string): string[] {
  const own = (
    container as {
      [TAGGED_KEYS]?: (tag: string) => readonly ServiceKey[];
    }
  )[TAGGED_KEYS];
  const keys = own ? own.call(container, tag) : container.keys;
  return keys.filter(
    (key): key is string => typeof key === 'string' && key.endsWith(`:${tag}`),
  );
}

const article = (kind: string) =>
  /^[aeiou]/.test(kind) ? `an ${kind}` : `a ${kind}`;

const quote = (key: ServiceKey) => `"${String(key)}"`;

/**
 * Hooks are singletons and depend on services, never on other hooks: not directly, and not through
 * the services they depend on. Nothing has run when this throws.
 */
function validate(
  container: LifecycleContainer,
  plan: readonly { stage: string; keys: readonly string[] }[],
  stages: readonly string[],
) {
  const isHook = (key: ServiceKey) =>
    typeof key === 'string' && stages.some((s) => key.endsWith(`:${s}`));
  const resolved = (key: ServiceKey) => {
    let info: RegistrationInfo | undefined = container.getRegistration(key);
    while (info?.linked) info = info.linked;
    return info;
  };
  /** The key a dependency of `owner` resolves to: in the owner's namespace first, then outward. */
  const visible = (owner: ServiceKey, key: ServiceKey): ServiceKey => {
    if (typeof owner !== 'string' || typeof key === 'symbol') return key;
    const parts = owner.split('.');
    for (let i = parts.length - 1; i > 0; i--) {
      const candidate = `${parts.slice(0, i).join('.')}.${key}`;
      if (container.has(candidate)) return candidate;
    }
    return key;
  };
  const dependsOnHook = (hook: string, on: ServiceKey, through: ServiceKey[]) =>
    new InjecuteError(
      'INJECUTE_INVALID_HOOK',
      `Lifecycle hook "${hook}" depends on the lifecycle hook ${quote(on)}${through.length > 0 ? ` (through ${through.map(quote).join(' → ')})` : ''}. Hooks depend on services; order them with stages.`,
    );
  for (const { stage, keys: hooks } of plan) {
    for (const key of hooks) {
      const info = resolved(key);
      if (info?.kind !== 'singleton') {
        throw new InjecuteError(
          'INJECUTE_INVALID_HOOK',
          `"${key}" ends with ":${stage}", so it is a lifecycle hook, but it is ${article(info?.kind ?? 'unknown registration')}. Rename it, or register the hook with addSingleton().`,
        );
      }
      const visited = new Set<ServiceKey>();
      const walk = (
        owner: ServiceKey,
        of: RegistrationInfo,
        through: ServiceKey[],
      ) => {
        for (const dependency of of.dependencies) {
          if (dependency.type === 'function') continue;
          if (dependency.type === 'collect') {
            const tag = dependency.tag;
            if (stages.includes(tag)) {
              throw new InjecuteError(
                'INJECUTE_INVALID_HOOK',
                `Lifecycle hook "${key}" collects the lifecycle hooks of the stage "${tag}"${through.length > 0 ? ` (through ${through.map(quote).join(' → ')})` : ''}. Hooks depend on services; order them with stages.`,
              );
            }
            for (const target of tagged(container, tag)) {
              if (visited.has(target)) continue;
              visited.add(target);
              const next = resolved(target);
              if (next) walk(target, next, [...through, target]);
            }
            continue;
          }
          if (dependency.type === 'previous') {
            // decorating: the previous definition of a hook is a hook too
            if (isHook(dependency.key))
              throw dependsOnHook(key, dependency.key, through);
            continue;
          }
          const target = visible(owner, dependency.key);
          if (isHook(target)) throw dependsOnHook(key, target, through);
          if (visited.has(target)) continue;
          visited.add(target);
          const next = resolved(target);
          if (next) walk(target, next, [...through, target]);
        }
      };
      walk(key, info, []);
    }
  }
}

const runs = new WeakMap<object, Promise<RunningLifecycle>>();
const stopped = new WeakSet<object>();

/**
 * Starts the application: runs the lifecycle hooks of every stage, stage by stage, and returns a handle
 * to stop them.
 *
 * - A **hook** is a singleton registered under a stage key (`lifecycle.start('server')`, the key
 *   `'server:start'`). Its factory is the hook; it may return a function that undoes it. Hooks are found
 *   in the container and its namespaces (`'Payments.consumer:start'`), and run in registration order:
 *   one by one, or all at once for the stages in `concurrent`.
 * - **Failures:** when a hook fails, the hooks that ran are undone in reverse, the container is disposed
 *   (unless `dispose: false`) and the promise rejects with the first failure.
 * - **Stopping:** `running.stop()` undoes the hooks in reverse, the last stage first, then disposes the
 *   container.
 *
 * Run it on the composition root (in tests, on an isolated fork). A lifecycle runs once per container:
 * calling it again returns the first call's promise (its options are ignored), also when that start
 * failed; after `stop()`, it rejects with `INJECUTE_LIFECYCLE_STOPPED`. Invalid options and hooks reject before
 * anything runs, and leave the container as it is.
 *
 * @throws {InjecuteError} (as a rejection) `INJECUTE_INVALID_HOOK` when a hook is not a singleton or
 * depends on another hook, `INJECUTE_RESOLUTION_FAILED` when a hook fails or the signal aborts,
 * `INJECUTE_LIFECYCLE_STOPPED` after `stop()`, `INJECUTE_INVALID_OPTION` for invalid options.
 *
 * @example
 * ```ts
 * const running = await startLifecycle(app); // init → start → ready
 * // undo ready → start → init, then app.dispose(); stop() rejects when something failed to stop
 * process.once('SIGTERM', () => running.stop().catch((error) => logger.error(error)));
 * ```
 */
export function startLifecycle<
  C extends LifecycleContainer,
  S extends string = 'init' | 'start' | 'ready',
>(
  container: C & CheckHooks<C, S>,
  options?: StartLifecycleOptions<S>,
): Promise<RunningLifecycle> {
  if (stopped.has(container)) {
    return Promise.reject(
      new InjecuteError(
        'INJECUTE_LIFECYCLE_STOPPED',
        'The lifecycle of this container was stopped. Start a new container (or an isolated fork) instead.',
      ),
    );
  }
  let run = runs.get(container);
  if (run) return run;
  // Invalid options and hooks reject before anything runs: not cached, the container is left as it is.
  let plan: Plan;
  try {
    plan = prepare(container, options ?? {});
  } catch (error) {
    return Promise.reject(error);
  }
  run = start(container, options ?? {}, plan);
  runs.set(container, run);
  return run;
}

type Plan = { stage: string; keys: string[]; concurrent: boolean }[];

/** Reads the options and finds and validates the hooks of every stage. */
function prepare(
  container: LifecycleContainer,
  options: StartLifecycleOptions<string>,
): Plan {
  const stages = stagesOf(options.lifecycle ?? lifecycle);
  const concurrent = new Set<string>(
    options.concurrent === true ? stages : options.concurrent || [],
  );
  for (const stage of concurrent) {
    if (!stages.includes(stage)) {
      throw invalidOption(
        `"concurrent" names the stage "${stage}", which this lifecycle does not have (${stages.join(', ')}).`,
      );
    }
  }
  const plan = stages.map((stage) => ({
    stage,
    keys: tagged(container, stage),
    concurrent: concurrent.has(stage),
  }));
  validate(container, plan, stages);
  return plan;
}

async function start(
  container: LifecycleContainer,
  options: StartLifecycleOptions<string>,
  plan: Plan,
): Promise<RunningLifecycle> {
  const provider = container as unknown as ServiceProvider<any>;
  const { signal, onError } = options;
  const shouldDispose = options.dispose ?? true;
  const report = (error: unknown, context: LifecycleErrorContext) => {
    try {
      onError?.(error, context);
    } catch {
      // a failing reporter must not hide the start failure
    }
  };
  const notify: Notify = (event) => {
    try {
      options.onHook?.(event);
    } catch {
      // a failing listener must not break the start or the stop
    }
  };
  const ran: StageRun[] = [];
  const order: ServiceKey[] = [];

  /** Hooks the start signal gave up on, still running: undone when they settle. */
  const late: Promise<unknown>[] = [];

  /**
   * Undoes what ran and disposes. The undo functions get the start signal (aborted after a timeout:
   * their cue to be quick) and are waited for. `dispose()` waits for singletons still being created, so
   * while a hook the signal gave up on is running, it continues in the background.
   */
  const fail = async (failures: readonly Failure[]): Promise<never> => {
    for (const { key, error } of failures.slice(1))
      report(error, { key, during: 'start' });
    const passed = signal ?? neverAborted();
    for (const { key, error } of await undoAll(ran, passed, undefined, notify))
      report(error, { key, during: 'rollback' });
    if (shouldDispose) {
      const disposing = disposeContainer(container, undefined).then(
        (errors) => {
          for (const error of errors) report(error, { during: 'dispose' });
        },
      );
      if (late.length === 0) await disposing;
    }
    throw failures[0]!.error;
  };

  /** A hook that settles after the start was aborted is undone as soon as it settles. */
  const undoLate = (key: ServiceKey, promise: Promise<unknown>) => {
    late.push(promise);
    promise.then(
      async (value) => {
        if (typeof value !== 'function') return;
        try {
          await (value as Undo)(signal ?? neverAborted());
        } catch (error) {
          report(undoFailed(key, error), { key, during: 'rollback' });
        }
      },
      () => {},
    );
  };

  for (const { stage: name, keys, concurrent } of plan) {
    const stage: StageRun = { stage: name, concurrent, started: [] };
    ran.push(stage);
    const failures: Failure[] = [];
    const call = (key: string) => {
      const begin = now();
      return { begin, promise: attempt(() => provider.get(key)) };
    };
    const settle = (
      key: string,
      { begin, promise }: { begin: number; promise: Promise<unknown> },
      outcome: Outcome<unknown>,
    ) => {
      const ms = now() - begin;
      if (outcome.status === 'fulfilled') {
        const value = outcome.value;
        stage.started.push(
          typeof value === 'function' ? { key, undo: value as Undo } : { key },
        );
        order.push(key);
        notify({ key, stage: name, action: 'start', ms });
        return;
      }
      let error: unknown;
      if (outcome.status === 'rejected') error = outcome.reason;
      else {
        error = aborted(key, signal!.reason, true);
        undoLate(key, promise);
      }
      failures.push({ key, error });
      notify({ key, stage: name, action: 'start', ms, error });
    };
    if (concurrent) {
      const calls = keys.map((key) =>
        signal?.aborted ? undefined : call(key),
      );
      const outcomes = await Promise.all(
        calls.map((c) => (c ? waitFor(c.promise, signal) : ABORTED)),
      );
      keys.forEach((key, i) => {
        const c = calls[i];
        if (c) settle(key, c, outcomes[i]!);
        else failures.push({ key, error: aborted(key, signal!.reason, false) });
      });
    } else {
      for (const key of keys) {
        if (signal?.aborted) {
          failures.push({ key, error: aborted(key, signal.reason, false) });
          break;
        }
        const c = call(key);
        settle(key, c, await waitFor(c.promise, signal));
        if (failures.length > 0) break;
      }
    }
    if (failures.length > 0) return fail(failures);
  }

  let state: LifecycleState = 'started';
  let stopping: Promise<void> | undefined;
  const stop = (stopOptions?: StopLifecycleOptions): Promise<void> => {
    stopping ??= (async () => {
      state = 'stopping';
      stopped.add(container);
      const signal = stopOptions?.signal;
      const errors = (
        await undoAll(ran, signal ?? neverAborted(), signal, notify)
      ).map((f) => f.error);
      if (shouldDispose)
        errors.push(...(await disposeContainer(container, signal)));
      state = 'stopped';
      if (errors.length > 0) {
        throw new InjecuteError(
          'INJECUTE_DISPOSE_FAILED',
          `Failed to stop the lifecycle: ${errors.length} failure(s).`,
          { cause: new AggregateError(errors, 'Stop failures') },
        );
      }
    })();
    return stopping;
  };
  return {
    get state() {
      return state;
    },
    hooks: Object.freeze(order),
    stop,
    [asyncDispose]: () => stop(),
  };
}

// -------------------------------------------------------------------------------------- startable

/** The parameter types of a function or class. */
type ParametersOf<F> = F extends abstract new (...args: infer P) => unknown
  ? P
  : F extends (...args: infer P) => unknown
    ? P
    : never;

/** The services a dependency list needs, typed by the factory's parameters. */
type NeededServices<F, D extends readonly unknown[]> = {
  [
    I in keyof D & `${number}` as D[I] extends ServiceKey ? D[I] : never
  ]: ParametersOf<F>[I & keyof ParametersOf<F>];
};

/**
 * What to do with a {@link startable} service when the app starts and stops.
 *
 * @example
 * ```ts
 * const hooks: StartableHooks<Scheduler> = {
 *   stage: lifecycle.start,
 *   start: (scheduler) => scheduler.start(),
 *   stop: (scheduler, signal) => scheduler.stop({ force: signal.aborted }),
 * };
 * app.extend(startable('scheduler', Scheduler, ['jobs'], hooks));
 * ```
 */
export interface StartableHooks<T, P extends string = 'start'> {
  /** Starts the service; may return a promise. */
  start?: (service: T) => unknown;
  /** Stops the service when the app stops (or rolls back a failed start). */
  stop?: (service: T, signal: LifecycleSignal) => unknown;
  /** The stage to start in. Default: `lifecycle.start`. */
  stage?: Tag<LifecycleHook, P>;
}

/**
 * Registers a service and its lifecycle hook in one call: a module that `extend()` applies. The service
 * is registered under `key`, and a hook under `<key>:<stage>` (`'consumer:start'`) calls `start` with
 * the service when the app starts and `stop` when it stops.
 *
 * The services it needs are typed by the factory's parameters: annotate them on a function factory.
 * For an `AsyncDIContainer`, register the hook yourself (`addSingleton(lifecycle.start(key), …)`).
 *
 * @example
 * ```ts
 * const addPayments = (c: ServiceRegistry<{ bus: Bus }>) =>
 *   c.extend(
 *     startable('consumer', PaymentConsumer, ['bus'], {
 *       start: (consumer) => consumer.start(),
 *       stop: (consumer) => consumer.stop(),
 *     }),
 *   );
 * ```
 */
export function startable<
  const K extends string,
  F extends
    (abstract new (...args: any) => unknown) | ((...args: any) => unknown),
  const D extends readonly unknown[],
  P extends string = 'start',
>(
  key: K,
  factory: F,
  dependencies: D,
  hooks: StartableHooks<Awaited<Produced<F>>, P>,
): (
  registry: ServiceRegistry<NeededServices<F, D>, {}>,
) => ServiceRegistry<
  any,
  { [Q in K]: Produced<F> } & { [Q in `${K}:${P}`]: LifecycleHook }
> {
  const stage = (hooks.stage ?? lifecycle.start) as Tag<LifecycleHook, string>;
  const begin = (service: Awaited<Produced<F>>) => {
    const started = hooks.start?.(service);
    const undo = hooks.stop
      ? (signal: LifecycleSignal) => hooks.stop!(service, signal)
      : undefined;
    return isThenable(started)
      ? Promise.resolve(started).then(() => undo)
      : undo;
  };
  return (registry) =>
    (registry as unknown as ServiceRegistry<any, any>)
      .addSingleton(key, factory as never, [...dependencies] as never)
      .addSingleton(
        stage(key),
        (service: unknown) =>
          isThenable(service)
            ? Promise.resolve(service).then((s) =>
                begin(s as Awaited<Produced<F>>),
              )
            : begin(service as Awaited<Produced<F>>),
        [key],
      ) as never;
}
