/**
 * Helpers shared between the container and the utils. Not exported from the package entry point.
 * @internal
 */

/** @internal Symbol of the method setCacheInstance() uses. */
export const SET_CACHE_INSTANCE: unique symbol = Symbol(
  'injecute.setCacheInstance',
);

/**
 * @internal
 * Class constructors have a non-writable `prototype`; plain, arrow, async and generator functions do
 * not. Bound functions and ES5-compiled classes are not detected: register those with `construct()`.
 */
export const isClass = (f: unknown): boolean =>
  typeof f === 'function' &&
  Object.getOwnPropertyDescriptor(f, 'prototype')?.writable === false;

// Well-known symbols with the same fallback TypeScript's `using` helper uses, for runtimes without them.
// Kept in the declaration files: the container's declarations refer to them.
/** `Symbol.asyncDispose`, or its fallback. */
export const asyncDispose: typeof Symbol.asyncDispose = (Symbol.asyncDispose ??
  Symbol.for('Symbol.asyncDispose')) as typeof Symbol.asyncDispose;
/** `Symbol.dispose`, or its fallback. */
export const syncDispose: typeof Symbol.dispose = (Symbol.dispose ??
  Symbol.for('Symbol.dispose')) as typeof Symbol.dispose;

/** @internal Symbol of the method that lists the keys collect(tag) resolves. */
export const TAGGED_KEYS: unique symbol = Symbol('injecute.taggedKeys');

/** @internal `true` for promises and other objects with a `then` method. */
export const isThenable = (v: unknown): v is PromiseLike<unknown> =>
  (typeof v === 'object' || typeof v === 'function') &&
  v !== null &&
  typeof (v as { then?: unknown }).then === 'function';

/** @internal A function that calls `factory`, with `new` when it is a class. */
export function callableOf(factory: unknown): (...args: any[]) => unknown {
  if (isClass(factory)) {
    const Class = factory as new (...args: any[]) => unknown;
    return (...args) => new Class(...args);
  }
  return factory as (...args: any[]) => unknown;
}
