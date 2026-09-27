import { DIContainer } from '../container.ts';
import { SET_CACHE_INSTANCE } from '../internal.ts';
import type { ContainerServices, IDIContainer } from '../types.ts';

/**
 * Allows to override any container entry until container.reset() used, factories is not touched.
 * use case: Designed to replace some entries for testing
 * @example ```
 * container.reset(); // clear cached singletons, all services will use new 'service'
 * setCacheInstance(container, 'service', mockObject); // replace 'service' with mock
 * // ... do the testing stuff;
 * container.reset(); // clear cached singletons with mocked 'service'
 * ```
 */
export function setCacheInstance<
  C extends IDIContainer<any, any>,
  S extends ContainerServices<C>,
  K extends keyof S,
>(container: C, key: K, instance: S[K]): void {
  if (!(container instanceof DIContainer)) {
    throw new Error('Only DIContainer supported');
  }
  container[SET_CACHE_INSTANCE](key, instance);
}
