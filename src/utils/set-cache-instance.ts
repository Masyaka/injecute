import { DIContainer } from '../container';
import { ContainerServices, IDIContainer } from '../types';

function _setSingletonInstance<
  C extends DIContainer<any, any>,
  S extends ContainerServices<C>,
  K extends keyof S,
>(this: C, key: K, instance: S[K]) {
  this.setSingletonInstance(key, instance);
}

/**
 * Allows to override any container entry until container.reset() used, factories is not touched.
 * use case: Designed to replace some entries for testing
 * @example ```
 * container.reset(); // clear cached singletons, all services will use new 'service'
 * setCacheInstance(container, 'service', mockObject); // replace 'service' with mock
 * // ... do the testing stuff;
 * container.reset(); // clear cached singletons with mocked 'service'
 * ```
 * @param this
 * @param key
 * @param instance
 */
export function setCacheInstance<
  C extends IDIContainer<any, any>,
  S extends ContainerServices<C>,
  K extends keyof S,
>(container: C, key: K, instance: S[K]) {
  if (!(container instanceof DIContainer)) {
    throw new Error('Only DIContainer supported');
  }
  _setSingletonInstance.call(container, key, instance);
}
