import { InjecuteError } from './errors.ts';
import type {
  CollectDependency,
  OptionalDependency,
  ServiceKey,
  Tag,
} from './types.ts';

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

const COLLECT: unique symbol = Symbol('injecute.collect');

interface CollectMarker {
  readonly [COLLECT]: string;
}

/**
 * Creates a tag: a name for an extension point that modules contribute services to. Calling the tag
 * builds the key of a contribution (`route('orders')` is `'orders:route'`); a factory that depends on
 * `collect(tag)` receives every contribution. Give the tag the contributions' type with `.of<T>()`.
 *
 * Tag names are non-empty and contain no `:` or `.`.
 *
 * @throws {InjecuteError} `INJECUTE_INVALID_OPTION` for an invalid name.
 *
 * @example
 * ```ts
 * export const route = createTag('route').of<Route>();
 *
 * // a module contributes
 * c.addSingleton(route('orders'), (db): Route => ordersRoute(db), ['db']);
 * // the owner collects
 * c.addSingleton('router', (routes) => new Router(routes), [collect(route)]);
 * ```
 */
export function createTag<const N extends string>(name: N): Tag<unknown, N> {
  if (typeof name !== 'string' || !/^[^:.]+$/.test(name)) {
    throw new InjecuteError(
      'INJECUTE_INVALID_OPTION',
      `Tag "${String(name)}" is not valid: tag names are non-empty and contain no ":" or ".".`,
    );
  }
  const tag = (key: string) => {
    if (typeof key !== 'string' || key === '') {
      throw new InjecuteError(
        'INJECUTE_INVALID_OPTION',
        `A key under the tag "${name}" needs a name: ${name}("…") got ${JSON.stringify(key)}.`,
      );
    }
    return `${key}:${name}`;
  };
  Object.defineProperties(tag, {
    tagName: { value: name, enumerable: true },
    of: { value: () => tag },
  });
  return Object.freeze(tag) as unknown as Tag<unknown, N>;
}

/**
 * A dependency on every service registered under a tag: every key that ends with `:<tag>`, also in
 * namespaces (`Orders.orders:route`), in registration order. The services are collected in the
 * container that creates the dependent service, so an isolated fork's replacements and additions are
 * included. An `AsyncDIContainer` awaits each of them.
 *
 * @throws {InjecuteError} `INJECUTE_INVALID_DEPENDENCY` when `tag` is not a tag made by `createTag()`.
 *
 * @example
 * ```ts
 * const command = createTag('command').of<Command>();
 *
 * app
 *   .addSingleton(command('migrate'), MigrateCommand, ['db'])
 *   .addSingleton(command('seed'), SeedCommand, ['db'])
 *   .addSingleton('cli', (commands) => new Cli(commands), [collect(command)]); // Command[]
 * ```
 */
export function collect<T>(tag: Tag<T, string>): CollectDependency<T> {
  const name = (tag as { tagName?: unknown } | undefined)?.tagName;
  if (typeof tag !== 'function' || typeof name !== 'string') {
    throw new InjecuteError(
      'INJECUTE_INVALID_DEPENDENCY',
      'collect() needs a tag made by createTag().',
    );
  }
  return Object.freeze({ [COLLECT]: name }) as unknown as CollectDependency<T>;
}

/** @internal */
export function collectedTag(dependency: unknown): string | undefined {
  return typeof dependency === 'object' &&
    dependency !== null &&
    COLLECT in dependency
    ? (dependency as CollectMarker)[COLLECT]
    : undefined;
}
