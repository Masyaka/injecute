import type { ServiceKey } from '../types.ts';

/** A key to expose, or `[key, exposedName]` to expose it under another name. */
export type KeySpec<S> = keyof S | readonly [keyof S, ServiceKey];

/** The exposed name of a {@link KeySpec}. */
export type ExposedName<E, S> = E extends readonly [
  keyof S,
  infer N extends ServiceKey,
]
  ? N
  : E extends keyof S
    ? E
    : never;

/** The service key behind a {@link KeySpec}. */
export type SpecKey<E, S> = E extends readonly [
  infer K extends keyof S,
  ServiceKey,
]
  ? K
  : E extends keyof S
    ? E
    : never;

/** @internal */
export const specPair = (spec: unknown): [ServiceKey, ServiceKey] =>
  Array.isArray(spec)
    ? [spec[0] as ServiceKey, spec[1] as ServiceKey]
    : [spec as ServiceKey, spec as ServiceKey];
