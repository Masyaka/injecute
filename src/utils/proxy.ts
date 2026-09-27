import type {
  ContainerServices,
  ServiceKey,
  ServiceProvider,
} from '../types.ts';
import {
  type ExposedName,
  type KeySpec,
  type SpecKey,
  specPair,
} from './keys.ts';

/** Options for {@link createProxyAccessor}. */
export interface ProxyAccessorOptions<Keys> {
  /** Services to expose, as keys or `[key, exposedName]` pairs. Default: every service. */
  keys?: Keys;
  /** Return `undefined` for unknown properties instead of throwing. Default: `true`. */
  optional?: boolean;
}

/** The object {@link createProxyAccessor} returns when `keys` is given. */
export type ProxyAccessor<S, Keys extends readonly unknown[]> = {
  readonly [
    I in keyof Keys as I extends `${number}` ? ExposedName<Keys[I], S> : never
  ]: S[SpecKey<Keys[I], S>];
};

/**
 * Creates an object whose properties resolve container services on access. Use it to expose a
 * container as a plain service object, optionally only some keys and under other names.
 * The object is read-only; `Object.keys()`, `in` and spreading work.
 *
 * @example
 * ```ts
 * const billing = createProxyAccessor(app, {
 *   keys: ['invoices', ['createInvoiceHandler', 'createInvoice']],
 * });
 * billing.invoices;      // resolves 'invoices'
 * billing.createInvoice; // resolves 'createInvoiceHandler'
 * ```
 */
export function createProxyAccessor<
  C extends ServiceProvider,
  const Keys extends readonly KeySpec<ContainerServices<C>>[] | undefined =
    undefined,
>(
  container: C,
  options?: ProxyAccessorOptions<Keys>,
): Keys extends readonly unknown[]
  ? ProxyAccessor<ContainerServices<C>, Keys>
  : Readonly<ContainerServices<C>> {
  const provider = container as unknown as ServiceProvider<any>;
  const optional = options?.optional ?? true;
  const exposed = options?.keys
    ? new Map(
        options.keys.map(
          (spec) => specPair(spec).reverse() as [ServiceKey, ServiceKey],
        ),
      )
    : undefined;
  const keyOf = (property: ServiceKey) =>
    exposed ? exposed.get(property) : property;
  const names = (): ServiceKey[] =>
    exposed ? [...exposed.keys()] : [...container.keys];
  const readOnly = () => {
    throw new Error('The proxy accessor is read-only.');
  };
  return new Proxy({} as any, {
    get: (_target, property) => {
      const key = keyOf(property);
      if (key === undefined) {
        if (optional) return undefined;
        throw new Error(
          `"${String(property)}" is not exposed by this accessor.`,
        );
      }
      return provider.get(key, { optional });
    },
    has: (_target, property) => {
      const key = keyOf(property);
      return key !== undefined && container.has(key);
    },
    ownKeys: () =>
      names().filter((name) => {
        const key = keyOf(name);
        return key !== undefined && container.has(key);
      }) as (string | symbol)[],
    getOwnPropertyDescriptor: (_target, property) => {
      const key = keyOf(property);
      if (key === undefined || !container.has(key)) return undefined;
      return {
        enumerable: true,
        configurable: true,
        get: () => provider.get(key),
      };
    },
    set: readOnly,
    defineProperty: readOnly,
    deleteProperty: readOnly,
  });
}
