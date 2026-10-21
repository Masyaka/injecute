/**
 * Adds the "how to fix it" hints to error messages in browser bundles that leave them out.
 *
 * Bundlers that build for browsers leave the hints out of injecute's error messages, to keep the
 * bundle small, and keep them in development builds that use the `development` condition (Vite and
 * webpack do). Import this module where you want them anyway: with a bundler that doesn't use the
 * condition, in a staging build, or to debug a production build. Everywhere else (Node.js, Deno,
 * Bun, browsers without a bundler, development builds) messages have the hints already, and this
 * import does nothing.
 *
 * Every error still has its `code` and a `docs` link to its page, which has the hint too.
 *
 * @example Hints in development only, with any bundler
 * ```ts
 * if (import.meta.env.DEV) await import('injecute/hints');
 * ```
 *
 * @example Hints in every build
 * ```ts
 * import 'injecute/hints';
 * ```
 *
 * @module
 */
import { errorCodes } from './error-codes.ts';
import { registerHints } from './hints-none.ts';

registerHints((code) => errorCodes[code].hint);
