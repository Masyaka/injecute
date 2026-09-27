import { DIContainer } from '../container.ts';
import { InjecuteError } from '../errors.ts';
import { SET_CACHE_INSTANCE } from '../internal.ts';

/**
 * Overrides the cached value of `key` in `container` until the next `reset()`, without touching the
 * registration. Resolutions through this container (and its forks) return `value`.
 *
 * For tests, prefer an isolated fork with a replacement, which cannot leak:
 * `app.fork({ isolated: true }).addInstance('db', fakeDb, { replace: true })`.
 *
 * @example
 * ```ts
 * setCacheInstance(app, 'clock', fixedClock);
 * // ... test
 * app.reset();
 * ```
 */
export function setCacheInstance<S extends object, K extends keyof S>(
  container: DIContainer<S>,
  key: K,
  value: S[K],
): void {
  if (!(container instanceof DIContainer)) {
    throw new InjecuteError(
      'INJECUTE_INVALID_OPTION',
      'setCacheInstance() needs a DIContainer.',
    );
  }
  container[SET_CACHE_INSTANCE](key, value);
}
