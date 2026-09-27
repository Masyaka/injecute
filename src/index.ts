/**
 * Lightweight, type-safe, decorator-free dependency injection container for TypeScript.
 *
 * Dependencies are declared explicitly as keys. The container's type grows with every
 * registration, so `get()` results and factory parameters are fully typed, and a typo in a
 * dependency key is a compile error.
 *
 * Install: `npm i injecute` · `deno add jsr:@masyaka/injecute` · `bun add injecute`,
 * or import from a CDN: `https://esm.sh/injecute`.
 *
 * @example Register and resolve services
 * ```ts
 * import { DIContainer } from 'injecute';
 *
 * class UserRepository {
 *   constructor(readonly dbUrl: string) {}
 * }
 *
 * const container = new DIContainer()
 *   .addInstance('dbUrl', 'postgres://localhost/app')
 *   .addSingleton('users', UserRepository, ['dbUrl']);
 *
 * const users = container.get('users'); // typed as UserRepository
 * ```
 *
 * Documentation: https://masyaka.github.io/injecute/
 *
 * @module
 */
export type * from './types.ts';
export { DIContainer } from './container.ts';
export {
  CircularDependencyError,
  errorCodes,
  InjecuteError,
  type InjecuteErrorCode,
  type InjecuteErrorOptions,
} from './errors.ts';
export { optional } from './dependencies.ts';
export * from './utils/index.ts';
