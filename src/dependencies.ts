import type { OptionalDependency, ServiceKey } from './types.ts';

const OPTIONAL: unique symbol = Symbol('injecute.optional');

interface OptionalMarker {
  readonly [OPTIONAL]: ServiceKey;
}

/**
 * Marks a dependency as optional: the factory receives the service when it is registered, and
 * `undefined` otherwise.
 *
 * @example
 * ```ts
 * container.addSingleton(
 *   'mailer',
 *   (transport) => new Mailer(transport ?? consoleTransport),
 *   [optional('transport')],
 * );
 * ```
 */
export function optional<const K extends ServiceKey>(
  key: K,
): OptionalDependency<K> {
  return Object.freeze({ [OPTIONAL]: key }) as unknown as OptionalDependency<K>;
}

/** @internal */
export function optionalKey(dependency: unknown): ServiceKey | undefined {
  return typeof dependency === 'object' &&
    dependency !== null &&
    OPTIONAL in dependency
    ? (dependency as OptionalMarker)[OPTIONAL]
    : undefined;
}
