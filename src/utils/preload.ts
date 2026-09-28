import { isThenable } from '../internal.ts';
import type {
  AsyncServiceProvider,
  ContainerServices,
  ServiceKey,
  ServiceProvider,
} from '../types.ts';

/**
 * Resolves services up front, for example at startup, so configuration errors surface immediately.
 * Without `keys` it resolves every visible service; pass a list of keys or a predicate to narrow it.
 *
 * The returned promise settles once the async services (factories that return promises, and every
 * service of an {@link AsyncDIContainer}) are created, and rejects with the first failure: `await` it.
 * Synchronous failures of a sync container still throw immediately.
 *
 * @example
 * ```ts
 * await preload(app); // everything
 * await preload(app, ['db', 'cache']);
 * await preload(app, (key) => String(key).startsWith('Billing.'));
 * ```
 */
export function preload<C extends ServiceProvider | AsyncServiceProvider>(
  container: C,
  keys?:
    readonly (keyof ContainerServices<C>)[] | ((key: ServiceKey) => boolean),
): Promise<void> {
  const selected =
    keys === undefined
      ? container.keys
      : typeof keys === 'function'
        ? container.keys.filter(keys)
        : keys;
  const provider = container as unknown as ServiceProvider<any>;
  const pending: PromiseLike<unknown>[] = [];
  for (const key of selected) {
    const value: unknown = provider.get(key);
    if (isThenable(value)) pending.push(value);
  }
  return Promise.all(pending).then(() => undefined);
}
