import { DIContainer } from './container';
import { ArgumentsKey, Callable, Empty, Func } from './types';

export class AsyncDIContainer<
  TOwnServices extends Record<ArgumentsKey, any> = Empty,
  TParentServices extends Record<ArgumentsKey, any> = Empty,
> extends DIContainer<TOwnServices, TParentServices> {
  protected override applyCallable<D extends any[]>(
    callable: Callable<D, any>,
    dependencies: D,
  ) {
    const func = callable as Func<any, any>;
    const dependenciesInstances: any =
      this.mapDependenciesToInstances(dependencies);
    return Promise.all(dependenciesInstances).then((awaited) =>
      func(...(awaited as Parameters<typeof func>)),
    );
  }
}
