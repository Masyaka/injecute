import type {
  ContainerServices,
  ServiceKey,
  ServiceProvider,
} from '../types.ts';

/**
 * Resolves services up front, for example at startup, so configuration errors surface immediately.
 * Without `keys` it resolves every visible service; pass a list of keys or a predicate to narrow it.
 *
 * @example
 * ```ts
 * preload(app); // everything
 * preload(app, ['db', 'cache']);
 * preload(app, (key) => String(key).startsWith('Billing.'));
 * ```
 */
export function preload<C extends ServiceProvider>(
  container: C,
  keys?:
    readonly (keyof ContainerServices<C>)[] | ((key: ServiceKey) => boolean),
): void {
  const selected =
    keys === undefined
      ? container.keys
      : typeof keys === 'function'
        ? container.keys.filter(keys)
        : keys;
  const provider = container as unknown as ServiceProvider<any>;
  for (const key of selected) provider.get(key);
}
