import { Argument, optionalDependencySkipKey } from "./types";

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

export const argumentsNamesToArguments = (argsNames: string[]): Argument[] =>
  argsNames.map((a) => ({
    name: a as string,
    required: a !== optionalDependencySkipKey,
  }));
