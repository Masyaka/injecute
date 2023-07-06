import {
  ArgumentsKey,
  ContainerServices,
  IDIContainer,
  Resolve,
} from '../types';

export type ResolversTuple<
  TServices extends Record<string, any>,
  Keys extends readonly (keyof TServices)[],
> = Keys extends [
  infer Key extends keyof TServices,
  ...infer Rest extends readonly any[],
]
  ? [Resolve<TServices[Key]>, ...ResolversTuple<TServices, Rest>]
  : [];
export const createResolversTuple = <
  C extends IDIContainer<any>,
  TServices extends ContainerServices<C>,
  const Keys extends (keyof TServices)[],
>(
  container: C,
  keys: [...Keys],
): ResolversTuple<TServices, Keys> => {
  return keys.map((k) => container.createResolver(k)) as ResolversTuple<
    TServices,
    Keys
  >;
};

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

export const createNamedResolvers = <
  C extends IDIContainer<any>,
  TServices extends ContainerServices<C>,
  NewKey extends ArgumentsKey,
  Keys extends (keyof TServices | [keyof TServices, NewKey])[],
  KeysPairs extends ResolversMapKeys<Keys>,
>(
  container: C,
  keys: [...Keys],
): {
  [K in keyof KeysPairs as KeysPairs[K] extends [keyof TServices, NewKey]
    ? KeysPairs[K][1]
    : never]: K extends string
    ? KeysPairs[K] extends [keyof TServices, NewKey]
      ? Resolve<TServices[KeysPairs[K][0]]>
      : never
    : never;
} => {
  return keys.reduce((r: any, c) => {
    if (Array.isArray(c)) {
      r[c[1]] = container.createResolver(c[0]);
    } else {
      r[c] = container.createResolver(c);
    }
    return r;
  }, {});
};

export type NamedResolvers<T extends Record<ArgumentsKey, any>> = {
  [K in keyof T]: Resolve<T[K]>;
};

export const addNamedResolvers =
  <
    R extends NamedResolvers<any>,
    S extends R extends NamedResolvers<infer Values> ? Values : never,
  >(
    resolvers: R,
  ) =>
  <T extends Record<ArgumentsKey, any>>(c: IDIContainer<T>) => {
    Object.entries(resolvers).forEach(([k, r]) => {
      c.addTransient(k as any, r);
    });
    return c as IDIContainer<T & S>;
  };
