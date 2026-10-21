import type { InjecuteErrorCode } from './errors.ts';

// Browser production bundles: no hints, until `import 'injecute/hints'` registers them. The state
// lives in this module on purpose (see Exceptions in docs/concepts/principles.md): hints configure
// how errors print, for every container.
let registered: ((code: InjecuteErrorCode) => string | undefined) | undefined;

/** @internal The registered hint for an error code, if `injecute/hints` was imported. */
export const hintOf = (code: InjecuteErrorCode): string | undefined =>
  registered?.(code);

/** @internal Used by `injecute/hints`. */
export const registerHints = (
  hints: (code: InjecuteErrorCode) => string | undefined,
): void => {
  registered = hints;
};
