import type { errorCodes } from './error-codes.ts';
import { hintOf } from './hints.ts';
import type { ServiceKey } from './types.ts';

export { errorCodes } from './error-codes.ts';

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
    const hint = hintOf(code);
    if (hint) lines.push(`  Hint: ${hint}`);
    lines.push(`  Docs: ${errorDocsUrl(code)}`);
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
