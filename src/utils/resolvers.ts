import type {
  ContainerServices,
  ServiceKey,
  ServiceProvider,
  ServiceRegistry,
  ServiceType,
} from '../types.ts';
import {
  type ExposedName,
  type KeySpec,
  type SpecKey,
  specPair,
} from './keys.ts';

/** A tuple of resolver functions, one per key. */
export type ResolversTuple<S, Keys extends readonly (keyof S)[]> = {
  -readonly [I in keyof Keys]: () => ServiceType<S, Keys[I]>;
};

/** An object of resolver functions, named by the exposed names. */
export type NamedResolversOf<S, Keys extends readonly unknown[]> = {
  [
    I in keyof Keys as I extends `${number}` ? ExposedName<Keys[I], S> : never
  ]: () => ServiceType<S, SpecKey<Keys[I], S>>;
};

/** Resolver functions by service key. */
export type NamedResolvers<T> = { [K in keyof T]: () => T[K] };

/**
 * Returns one resolver function per key, in order.
 *
 * @example
 * ```ts
 * const [getUsers, getMailer] = createResolversTuple(app, ['users', 'mailer']);
 * ```
 */
export function createResolversTuple<
  C extends ServiceProvider,
  const Keys extends readonly (keyof ContainerServices<C>)[],
>(container: C, keys: Keys): ResolversTuple<ContainerServices<C>, Keys> {
  const provider = container as unknown as ServiceProvider<any>;
  return keys.map((key) => provider.createResolver(key)) as any;
}

/**
 * Returns an object of resolver functions, named by key or by `[key, name]` pairs.
 *
 * @example
 * ```ts
 * const resolvers = createNamedResolvers(app, ['users', ['mailer', 'getMailer']]);
 * resolvers.users();
 * resolvers.getMailer();
 * ```
 */
export function createNamedResolvers<
  C extends ServiceProvider,
  const Keys extends readonly KeySpec<ContainerServices<C>>[],
>(container: C, keys: Keys): NamedResolversOf<ContainerServices<C>, Keys> {
  const provider = container as unknown as ServiceProvider<any>;
  const result: Record<ServiceKey, () => unknown> = {};
  for (const spec of keys) {
    const [key, name] = specPair(spec);
    result[name] = provider.createResolver(key);
  }
  return result as any;
}

/**
 * Turns resolver functions (e.g. from another container) into a module that registers them as
 * transient services. Use it with `extend()` to share services between independent containers.
 *
 * @example
 * ```ts
 * const shared = createNamedResolvers(core, ['db', 'logger']);
 * const feature = new DIContainer().extend(addNamedResolvers(shared));
 * feature.get('db'); // resolved by `core`
 * ```
 */
export function addNamedResolvers<T extends object>(
  resolvers: NamedResolvers<T>,
): (registry: ServiceRegistry<{}, {}>) => ServiceRegistry<{}, T> {
  return (registry) => {
    for (const key of Reflect.ownKeys(resolvers)) {
      const resolve = (resolvers as Record<ServiceKey, () => unknown>)[key]!;
      (registry as ServiceRegistry<any, any>).addTransient(key, () =>
        resolve(),
      );
    }
    return registry as unknown as ServiceRegistry<{}, T>;
  };
}
