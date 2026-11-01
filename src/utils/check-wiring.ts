import { InjecuteError } from '../errors.ts';
import { isThenable } from '../internal.ts';
import type {
  AsyncServiceProvider,
  ContainerServices,
  RegistrationInfo,
  ServiceKey,
  ServiceProvider,
} from '../types.ts';

/** Options of {@link checkWiring}. */
export interface CheckWiringOptions<K> {
  /**
   * Keys that must be registered, besides every dependency key: for example every key of the
   * `Services` a module declares for services it registers from files or decorators.
   */
  keys?: readonly K[];
  /**
   * Also resolve every service, so factories that throw are found too. Runs the factories: use an
   * isolated fork with fakes for services that reach the outside world. Default: `false`.
   */
  resolve?: boolean;
}

/** One problem found by {@link checkWiring}. */
export interface WiringProblem {
  /**
   * `missing`: nothing registers `key`, but a service depends on it, or it is in `keys`.
   * `failed`: resolving `key` threw (only with `resolve: true`).
   */
  readonly type: 'missing' | 'failed';
  /** The missing key, or the service whose factory failed. */
  readonly key: ServiceKey;
  /** Services that need `key`, directly or through other services. With `resolve`, they were skipped. */
  readonly affected: readonly ServiceKey[];
  /** For `failed`: the error resolving `key` threw (usually `INJECUTE_RESOLUTION_FAILED`, with the original as `cause`). */
  readonly error?: unknown;
}

/** Thrown by {@link checkWiring}: every problem it found, in `problems`. */
export class WiringError extends InjecuteError {
  /** `'WiringError'`. */
  override readonly name: string = 'WiringError';
  /** Every problem found, missing keys first. */
  readonly problems: readonly WiringProblem[];

  constructor(problems: readonly WiringProblem[]) {
    const lines = problems.map((problem) => `  - ${describe(problem)}`);
    const errors = problems.flatMap((p) =>
      p.type === 'failed' ? [p.error] : [],
    );
    super(
      'INJECUTE_WIRING_FAILED',
      `The wiring check found ${problems.length} problem${problems.length === 1 ? '' : 's'}:\n${lines.join('\n')}`,
      errors.length
        ? { cause: new AggregateError(errors, 'Services failed to resolve') }
        : {},
    );
    this.problems = problems;
  }
}

const quote = (key: ServiceKey) => `"${String(key)}"`;

function describe(problem: WiringProblem): string {
  const affected = problem.affected.map(quote).join(', ');
  if (problem.type === 'missing') {
    return problem.affected.length
      ? `${quote(problem.key)} is not registered. Needed by ${affected}.`
      : `${quote(problem.key)} is not registered, but it is listed in keys.`;
  }
  const error = problem.error;
  const reason =
    error instanceof InjecuteError && error.cause instanceof Error
      ? error.cause.message
      : error instanceof Error
        ? error.message.split('\n')[0]
        : String(error);
  const sentence = /[.!?]$/.test(reason) ? reason : `${reason}.`;
  return `${quote(problem.key)} failed: ${sentence}${problem.affected.length ? ` Not resolved because of it: ${affected}.` : ''}`;
}

/** The registration a namespace entry finally resolves to: its dependencies are the linked ones. */
const finalRegistration = (info: RegistrationInfo): RegistrationInfo => {
  let current = info;
  while (current.linked) current = current.linked;
  return current;
};

/**
 * Checks that everything the container's services need is registered, and with `resolve: true` that
 * every service can be created. Reports every problem at once: missing keys first (found without
 * running anything), then factories that throw, each with the services it affects. Resolves when
 * there is nothing to report, and rejects with a {@link WiringError} otherwise.
 *
 * Use it in a test. To create services at startup, use {@link preload}.
 *
 * @example Check the wiring without running factories
 * ```ts
 * it('wires every service', async () => {
 *   await checkWiring(createApp());
 * });
 * ```
 *
 * @example Also run every factory, with fakes for the outside world
 * ```ts
 * await using test = createApp()
 *   .fork({ isolated: true })
 *   .addInstance('db', fakeDb, { replace: true });
 * await checkWiring(test, { resolve: true });
 * ```
 *
 * @example Services the compiler can't see: list the declared keys
 * ```ts
 * const declared = { clock: true, greeter: true } satisfies Record<keyof Services, true>;
 * await checkWiring(app, { keys: Object.keys(declared) as (keyof Services)[] });
 * ```
 */
export async function checkWiring<
  C extends ServiceProvider | AsyncServiceProvider,
>(
  container: C,
  options: CheckWiringOptions<keyof ContainerServices<C>> = {},
): Promise<void> {
  const visible = container.keys;

  // A dependency of a namespace service is looked up in its namespace first: `Ns.key`, then `key`.
  const lookup = (
    owner: ServiceKey,
    key: ServiceKey,
  ): ServiceKey | undefined => {
    if (typeof key !== 'string' && typeof key !== 'number')
      return container.has(key) ? key : undefined;
    const parts = String(owner).split('.');
    for (let i = parts.length - 1; i >= 0; i--) {
      const namespace = parts.slice(0, i).join('.');
      const candidate = namespace ? `${namespace}.${key}` : key;
      if (container.has(candidate)) return candidate;
    }
    return undefined;
  };

  // Direct dependencies of every service, as visible keys, and the keys nothing registers.
  const dependencies = new Map<ServiceKey, ServiceKey[]>();
  const missing = new Map<ServiceKey, ServiceKey[]>();
  for (const key of visible) {
    const info = container.getRegistration(key);
    if (!info || info.kind === 'namespace') continue;
    const direct: ServiceKey[] = [];
    for (const dependency of finalRegistration(info).dependencies) {
      if (dependency.type === 'key' || dependency.type === 'optional') {
        const found = lookup(key, dependency.key);
        if (found !== undefined) direct.push(found);
        else if (dependency.type === 'key') {
          const neededBy = missing.get(dependency.key) ?? [];
          neededBy.push(key);
          missing.set(dependency.key, neededBy);
        }
      } else if (dependency.type === 'collect') {
        const suffix = `:${dependency.tag}`;
        for (const k of visible) if (String(k).endsWith(suffix)) direct.push(k);
      }
    }
    dependencies.set(key, direct);
  }
  for (const key of options.keys ?? []) {
    if (!container.has(key as ServiceKey) && !missing.has(key as ServiceKey))
      missing.set(key as ServiceKey, []);
  }

  // Services that need a key, directly or through other services.
  const dependents = new Map<ServiceKey, ServiceKey[]>();
  for (const [key, direct] of dependencies)
    for (const dependency of direct) {
      const list = dependents.get(dependency) ?? [];
      list.push(key);
      dependents.set(dependency, list);
    }
  const affectedBy = (roots: readonly ServiceKey[]): ServiceKey[] => {
    const seen = new Set<ServiceKey>();
    const queue = [...roots];
    while (queue.length) {
      for (const dependent of dependents.get(queue.shift()!) ?? [])
        if (!seen.has(dependent)) {
          seen.add(dependent);
          queue.push(dependent);
        }
    }
    return visible.filter((k) => seen.has(k));
  };

  const problems: WiringProblem[] = [];
  const skipped = new Set<ServiceKey>();
  for (const [key, neededBy] of missing) {
    const affected = neededBy.length
      ? [...new Set([...neededBy, ...affectedBy(neededBy)])]
      : [];
    for (const k of affected) skipped.add(k);
    problems.push({
      type: 'missing',
      key,
      affected: visible.filter((k) => affected.includes(k)),
    });
  }

  if (options.resolve) {
    // Dependencies first, so a failing service is resolved before the services that need it.
    const order: ServiceKey[] = [];
    const placed = new Set<ServiceKey>();
    const place = (key: ServiceKey) => {
      if (placed.has(key)) return;
      placed.add(key);
      for (const dependency of dependencies.get(key) ?? []) place(dependency);
      order.push(key);
    };
    for (const key of dependencies.keys()) place(key);

    const failures = new Map<
      ServiceKey,
      WiringProblem & { affected: ServiceKey[] }
    >();
    const provider = container as unknown as ServiceProvider<any>;
    for (const key of order) {
      if (skipped.has(key)) continue;
      try {
        const value: unknown = provider.get(key);
        if (isThenable(value)) await value;
      } catch (error) {
        // A service that resolves another one by hand fails at that one: report it there, once.
        const path = error instanceof InjecuteError ? error.path : [];
        const last = path[path.length - 1];
        const root =
          last !== undefined && last !== key && failures.has(last) ? last : key;
        const failure = failures.get(root);
        if (failure) {
          if (!failure.affected.includes(key)) failure.affected.push(key);
          continue;
        }
        const affected = affectedBy([key]);
        for (const k of affected) skipped.add(k);
        failures.set(key, { type: 'failed', key, affected, error });
      }
    }
    problems.push(...failures.values());
  }

  if (problems.length) throw new WiringError(problems);
}
