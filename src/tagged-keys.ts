// Types for keys built by tags. `TaggedKey` is public (exported from the entry point); the helpers are
// used in the registration signatures.

declare const taggedKeyBrand: unique symbol;

/**
 * A key built by a tag (`route('orders')`). It carries the tag's type, so registering a service under it
 * checks the service against that type. In the service map the key is the plain string
 * (`'orders:route'`).
 *
 * @example
 * ```ts
 * const route = createTag('route').of<Route>();
 * const key: 'orders:route' & TaggedKey<Route, 'orders:route'> = route('orders');
 * app.addSingleton(key, () => ({ path: '/orders' })); // checked against Route
 * ```
 */
export interface TaggedKey<T, K extends string | number | symbol = string> {
  /** Type only: the type of the services registered under this key, and the plain key. */
  readonly [taggedKeyBrand]: { readonly type: T; readonly key: K };
}

/** The key as it appears in the service map: a {@link TaggedKey} without its brand. */
export type RegisteredKey<K> = K extends TaggedKey<any, infer Key> ? Key : K;

/** The type of the services under a tagged key. */
type TagType<K> = (K & TaggedKey<unknown, any>)[typeof taggedKeyBrand]['type'];

/**
 * What a service registered under `K` must be: the tag's type for a tagged key, anything otherwise. It
 * constrains the factory's return type (and `addInstance`'s value), so a wrong service is a compile
 * error at the factory, and the factory's parameters stay typed.
 *
 * Written without `infer` and without distributing over `K`, so that inside a function with a generic
 * key (`<K extends string>(key: K) => c.addSingleton(key, …)`) TypeScript can still relate a factory to
 * it: anything is accepted there, as for any untagged key.
 */
export type ExpectedService<K> = [K] extends [TaggedKey<any, any>]
  ? TagType<K>
  : unknown;

/** Like {@link ExpectedService}, for async containers: a promise of the tag's type is fine too. */
export type AsyncExpectedService<K> = [K] extends [TaggedKey<any, any>]
  ? TagType<K> | PromiseLike<TagType<K>>
  : unknown;

/**
 * The keys an alias under `K` may point to: every key, or for a tagged key, the keys of services of the
 * tag's type (an alias is a contribution too).
 */
export type AliasTarget<K, S> = [K] extends [TaggedKey<any, any>]
  ? { [P in keyof S]: [S[P]] extends [TagType<K>] ? P : never }[keyof S]
  : keyof S;
