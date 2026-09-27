/**
 * Wraps a class in a factory function that calls it with `new`.
 *
 * Classes are usually registered directly (`addSingleton('repo', Repo, ['db'])`): the container detects
 * them. Use `construct()` for the classes it cannot detect, which look like plain functions:
 * - classes compiled to ES5 (Babel for old browsers, TypeScript `target: es5`, prebuilt ES5 libraries)
 * - bound classes (`Repo.bind(null)`)
 *
 * Registering one of those without `construct()` fails with `INJECUTE_CLASS_NOT_CONSTRUCTED`.
 *
 * @example
 * ```ts
 * import { LegacyClient } from 'some-es5-library';
 *
 * app.addSingleton('client', construct(LegacyClient), ['config']);
 * ```
 */
export const construct =
  <A extends unknown[], I>(Class: new (...args: A) => I) =>
  (...args: A): I =>
    new Class(...args);
