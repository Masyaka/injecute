import { ContainerServices, IDIContainer } from '../types';

export const createProxyAccessor = <C extends IDIContainer<any>>(
  c: C
): Readonly<ContainerServices<C>> =>
  new Proxy({} as any, {
    get: (target, p) => c.get(p),
    set: () => {
      throw new Error('Set through proxy is not supported');
    },
  });
