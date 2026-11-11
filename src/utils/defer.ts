import { callableOf } from '../internal.ts';

/** Each argument, or a promise of it. */
export type MaybePromises<T extends readonly unknown[]> = {
  [I in keyof T]: T[I] | PromiseLike<T[I]>;
};

/**
 * Wraps a factory so it accepts promises for any of its arguments: they are awaited before the factory
 * runs, and the wrapped factory returns a promise. Use it to register services that depend on async
 * services in a synchronous container.
 *
 * @example
 * ```ts
 * app
 *   .addSingleton('config', () => fetchConfig()) // Promise<Config>
 *   .addSingleton('db', defer((config: Config) => connect(config.dbUrl)), ['config']);
 *
 * const db = await app.get('db');
 * ```
 */
export function defer<A extends unknown[], R>(
  factory: ((...args: A) => R) | (new (...args: A) => R),
): (...dependencies: MaybePromises<A>) => Promise<Awaited<R>> {
  const call = callableOf(factory) as (...args: A) => R;
  return async (...dependencies): Promise<Awaited<R>> => {
    const resolved = (await Promise.all(dependencies)) as A;
    return await (call(...resolved) as Awaited<R>);
  };
}
