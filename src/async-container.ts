import { DIContainer } from './container.ts';

/**
 * Experimental: awaits every dependency before calling a factory, so factories receive resolved values
 * and every resolution returns a promise. Not exported from the package until its design is finished.
 */
export class AsyncDIContainer<S extends object = {}> extends DIContainer<S> {
  protected override invokeFactory(
    factory: (...args: any[]) => unknown,
    args: unknown[],
  ): unknown {
    return Promise.all(args).then((awaited) =>
      super.invokeFactory(factory, awaited),
    );
  }
}
