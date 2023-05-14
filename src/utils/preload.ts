import { ArgumentsKey, IDIContainer } from '../types';

/**
 * Use for warm up listed or predicated services.
 * Can be useful to check services for right configuration.
 * @example ```
 * preload(container, (k) => k.startsWith('Feature.Domain.'))
 * ```
 *
 * @param container
 * @param keys
 */
export const preload = <
  C extends IDIContainer<Record<ArgumentsKey, any>>,
  S extends C extends IDIContainer<infer Services> ? Services : never,
  K extends keyof S
>(
  container: C,
  keys?: K[] | ((k: K) => boolean)
) => {
  let toPreload: ArgumentsKey[];
  if (keys === undefined) {
    toPreload = container.keys;
  } else if (Array.isArray(keys)) {
    toPreload = keys;
  } else {
    toPreload = (container.keys as K[]).filter(keys);
  }

  for (const key of toPreload) {
    container.get(key);
  }
};
