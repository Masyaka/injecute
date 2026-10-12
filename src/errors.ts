import type { ServiceKey } from './types.ts';

/**
 * Every error injecute throws, with a short title and how to fix it. The docs pages under
 * `/errors/<slug>` are generated from this list.
 */
export const errorCodes = {
  INJECUTE_NOT_REGISTERED: {
    title: 'No service is registered under this key',
    hint: 'Register it (addSingleton / addTransient / addInstance) before resolving it, check the key for typos, or pass { optional: true } to get undefined instead.',
  },
  INJECUTE_ALREADY_REGISTERED: {
    title: 'The key is already registered in this container',
    hint: 'Pass { replace: true } to replace the registration, or use another key. A child container (fork) may register a key its parent has without replace.',
  },
  INJECUTE_CIRCULAR_DEPENDENCY: {
    title: 'Services depend on each other in a cycle',
    hint: 'Break the cycle: extract the shared part into its own service, or resolve one side lazily with a function dependency (() => container.get(key)).',
  },
  INJECUTE_NO_PREVIOUS_DEFINITION: {
    title: 'A service depends on itself but there is nothing to decorate',
    hint: 'A dependency on the key being registered resolves its previous definition (the replaced one, or the parent one). Register the original service first.',
  },
  INJECUTE_INVALID_FACTORY: {
    title: 'The factory is not a function or class',
    hint: 'Pass a function that creates the service, a class, or use addInstance() for a ready value.',
  },
  INJECUTE_INVALID_DEPENDENCY: {
    title:
      'A dependency is not a key, optional(key), collect(tag) or a function',
    hint: 'Dependencies are service keys, optional(key), collect(tag) with a tag made by createTag(), or functions that return the value.',
  },
  INJECUTE_CLASS_NOT_CONSTRUCTED: {
    title: 'A class was called without new',
    hint: 'Classes compiled to ES5 (Babel for old browsers, TypeScript target: es5) and bound classes cannot be detected. Register them with construct(MyClass).',
  },
  INJECUTE_RESOLUTION_FAILED: {
    title: 'A factory threw (or its promise rejected) while creating a service',
    hint: 'The original error is in `cause`; `path` shows which service needed it.',
  },
  INJECUTE_NOT_A_FUNCTION: {
    title: 'call() was used on a service that is not a function',
    hint: 'Only function services can be called with call(); use get() for other services.',
  },
  INJECUTE_NAMESPACE_CONFLICT: {
    title: 'The namespace name is already used by a service',
    hint: 'Choose another namespace name, or remove the service with that key.',
  },
  INJECUTE_NAMESPACE_RESULT: {
    title: 'A namespace callback returned something other than a new container',
    hint: 'Return the registry the callback received (after adding services), a fork of it, or a new DIContainer.',
  },
  INJECUTE_EXTENSION_RESULT: {
    title:
      'An extension returned a container that is not this one or its child',
    hint: 'A module function must return the registry it received (after adding services) or a fork of it.',
  },
  INJECUTE_SEALED: {
    title: 'The container is sealed',
    hint: 'Register every service before seal(). To add services later (per request, per test), register them in a fork: app.fork().addInstance(...).',
  },
  INJECUTE_DISPOSED: {
    title: 'The container is disposed',
    hint: 'Create a new container (or fork) instead of using one after dispose().',
  },
  INJECUTE_DISPOSE_FAILED: {
    title: 'Some services failed to dispose',
    hint: 'Every other service was still disposed. The failures are in `cause` (an AggregateError).',
  },
  INJECUTE_INVALID_OPTION: {
    title: 'An option is not supported here',
    hint: 'Transient services are not kept by the container, so they cannot have a dispose option. createTag() and createLifecycle() take unique, non-empty names without ":" or "."; startLifecycle() takes a lifecycle made by createLifecycle() and only its stages in "concurrent".',
  },
  INJECUTE_UNKNOWN_EVENT: {
    title: 'Unknown event name',
    hint: 'Supported events: add, replace, reset, get, produce, dispose.',
  },
  INJECUTE_READ_ONLY: {
    title: 'The object is read-only',
    hint: 'Proxy accessors only read services. Register or replace services on the container.',
  },
  INJECUTE_INVALID_HOOK: {
    title: 'A lifecycle hook is not registered correctly',
    hint: 'A key that ends with `:<stage>` is a lifecycle hook. Register it with addSingleton() under `lifecycle.<stage>(name)`, and let it depend on services, never on other hooks: order hooks with stages. Rename a key that is not meant as a hook.',
  },
  INJECUTE_UNDO_FAILED: {
    title: 'A lifecycle hook could not be undone',
    hint: 'Its undo function threw, rejected, or did not finish before the stop signal aborted. The hook is in `path`, the original error in `cause`.',
  },
  INJECUTE_LIFECYCLE_STOPPED: {
    title: 'The lifecycle of this container was stopped',
    hint: 'A lifecycle runs once per container. To start again, create a new container or an isolated fork.',
  },
} as const;

/** The `code` of an {@link InjecuteError}. */
export type InjecuteErrorCode = keyof typeof errorCodes;

const docsBase = 'https://masyaka.github.io/injecute/errors/';

/** The docs page of an error code, e.g. `…/errors/not-registered`. */
export const errorDocsUrl = (code: InjecuteErrorCode): string =>
  docsBase +
  code
    .replace(/^INJECUTE_/, '')
    .toLowerCase()
    .replace(/_/g, '-');

/** Options of an {@link InjecuteError}. */
export interface InjecuteErrorOptions {
  /** Service keys being resolved when the error happened, outermost first. */
  path?: readonly ServiceKey[];
  /** The underlying error. */
  cause?: unknown;
}

/**
 * The error injecute throws. `code` is stable (safe to branch on), `message` explains what happened
 * and how to fix it, `path` shows the resolution chain, and `docs` links to the error's page.
 *
 * @example
 * ```ts
 * try {
 *   app.get('users');
 * } catch (error) {
 *   if (error instanceof InjecuteError && error.code === 'INJECUTE_NOT_REGISTERED') {
 *     // ...
 *   }
 * }
 * ```
 */
export class InjecuteError extends Error {
  /** `'InjecuteError'` (or the subclass name). */
  override readonly name: string = 'InjecuteError';
  /** Stable identifier of the error. */
  readonly code: InjecuteErrorCode;
  /** Service keys being resolved when the error happened, outermost first. */
  readonly path: readonly ServiceKey[];
  /** Link to the documentation page of this error. */
  readonly docs: string;

  constructor(
    code: InjecuteErrorCode,
    message: string,
    options: InjecuteErrorOptions = {},
  ) {
    const path = options.path ?? [];
    const lines = [message];
    if (path.length > 1)
      lines.push(`  Resolving: ${path.map(String).join(' → ')}`);
    lines.push(
      `  Hint: ${errorCodes[code].hint}`,
      `  Docs: ${errorDocsUrl(code)}`,
    );
    super(
      lines.join('\n'),
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.code = code;
    this.path = path;
    this.docs = errorDocsUrl(code);
  }
}

/** Thrown when services depend on each other in a cycle; `path` is the cycle. */
export class CircularDependencyError extends InjecuteError {
  /** `'CircularDependencyError'`. */
  override readonly name: string = 'CircularDependencyError';

  constructor(cycle: readonly ServiceKey[]) {
    const last = cycle[cycle.length - 1];
    const description = cycle
      .map((k) => (k === last ? `*${String(k)}*` : String(k)))
      .join(' -> ');
    super(
      'INJECUTE_CIRCULAR_DEPENDENCY',
      `Circular dependency detected ${description}.`,
      { path: cycle },
    );
  }
}

/** @internal Up to three visible keys that look like `key`. */
export function suggestKeys(
  key: ServiceKey,
  candidates: readonly ServiceKey[],
): string[] {
  const target = String(key).toLowerCase();
  const limit = Math.max(2, Math.floor(target.length / 3));
  return candidates
    .map((candidate) => ({
      candidate: String(candidate),
      distance: levenshtein(target, String(candidate).toLowerCase()),
    }))
    .filter(({ distance }) => distance <= limit)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 3)
    .map(({ candidate }) => candidate);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length]!;
}

/**
 * @internal
 * Engine messages for calling a class without `new`: V8 (Node, Deno, Chrome), JavaScriptCore (Bun,
 * Safari), SpiderMonkey (Firefox) and Babel's classCallCheck.
 */
const classCallMessages = [
  /cannot be invoked without 'new'/i,
  /without \|new\|/i,
  /must be invoked with 'new'/i,
  /cannot call a class as a function/i,
];

/** @internal TypeScript's ES5 output assigning to `this` when called without `new`. */
const thisAssignment = /cannot set propert(y|ies) of undefined/i;

/** @internal Looks like an ES5 constructor: has methods on its prototype. */
export const looksLikeConstructor = (f: unknown): boolean =>
  typeof f === 'function' &&
  typeof (f as { prototype?: unknown }).prototype === 'object' &&
  (f as { prototype: object }).prototype !== null &&
  Object.getOwnPropertyNames((f as { prototype: object }).prototype).some(
    (name) => name !== 'constructor',
  );

/** @internal `error` was thrown because a class was called without `new`. */
export const isClassCallError = (error: unknown, factory: unknown): boolean => {
  if (!(error instanceof TypeError)) return false;
  if (classCallMessages.some((pattern) => pattern.test(error.message)))
    return true;
  const constructorLike =
    looksLikeConstructor(factory) ||
    (typeof factory === 'function' && /^[A-Z]/.test(factory.name));
  return constructorLike && thisAssignment.test(error.message);
};
