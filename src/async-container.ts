import { DIContainer } from './container.ts';
import { ArgumentsKey, Empty } from './types.ts';

/**
 * Experimental: awaits every dependency before calling a factory, so factories receive resolved values
 * and every resolution returns a promise. Not exported from the package until its design is finished.
 */
export class AsyncDIContainer<
  TOwnServices extends Record<ArgumentsKey, any> = Empty,
  TParentServices extends Record<ArgumentsKey, any> = Empty,
> extends DIContainer<TOwnServices, TParentServices> {
  protected override invokeFactory(
    factory: (...args: any[]) => unknown,
    args: unknown[],
  ): unknown {
    return Promise.all(args).then((awaited) =>
      super.invokeFactory(factory, awaited),
    );
  }
}
