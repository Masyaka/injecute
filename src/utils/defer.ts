import { Func } from '../types';

type MayBePromise<T> = T | Promise<T>;

type MayBePromiseTuple<Tuple extends readonly any[]> = Tuple extends readonly [
  infer Head extends any,
  ...infer Rest extends readonly any[],
]
  ? [MayBePromise<Head>, ...MayBePromiseTuple<Rest>]
  : [];

/**
 * Awaits all arguments before factory execution.
 * Factory result will be a promise.
 * @param factory
 */
export const defer = <
  Factory extends Func<readonly any[], any>,
  InitialArgs extends Factory extends Func<infer A, any> ? A : never,
  ResultArgs extends MayBePromiseTuple<InitialArgs>,
  Result extends Factory extends Func<any, infer R> ? R : never,
>(
  factory: Factory,
) => {
  return async (...dependencies: ResultArgs): Promise<Result> =>
    Promise.all(dependencies).then((r) => factory(...(r as InitialArgs)));
};
