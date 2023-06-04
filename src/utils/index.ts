import { Argument, ArgumentsKey, optionalDependencySkipKey } from '../types';
import { asNew } from './construct';
import { preload } from './preload';
import { createProxyAccessor } from './proxy';

const firstResultDefaultPredicate = (r: any) => r !== undefined && r !== null;
export const firstResult =
  <TArgs extends any[], TResult extends any>(
    fns: ((...args: TArgs) => TResult)[],
    predicate: (r: TResult) => boolean = firstResultDefaultPredicate
  ) =>
  (...args: TArgs): TResult | undefined => {
    for (const f of fns) {
      const result = f(...args);
      if (predicate(result)) return result;
    }
  };

export const argumentsNamesToArguments = (
  argsNames: (ArgumentsKey | (() => any))[]
): Argument[] =>
  argsNames.map((a) =>
    typeof a === 'function'
      ? { getter: a }
      : {
          name: a,
          required: a !== optionalDependencySkipKey,
        }
  );

export const utils = {
  preload,
  asNew,
  createProxyAccessor,
};
