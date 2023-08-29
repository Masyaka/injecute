import {
  ArgumentsKey,
  ContainerServices,
  IDIContainer,
  ResolversMapKeys,
} from '../types';

export type ProxyAccessorOptions<
  Services extends Record<ArgumentsKey, any>,
  NewKey extends ArgumentsKey,
  Keys extends readonly (keyof Services | [keyof Services, NewKey])[],
> = {
  allowUnresolved?: boolean;
  keys?: [...Keys];
};

type KeysOverride<
  TServices extends Record<ArgumentsKey, any>,
  Keys extends (keyof TServices | [keyof TServices, ArgumentsKey])[],
  KeysPairs extends ResolversMapKeys<Keys> = ResolversMapKeys<Keys>,
> = {
  [K in keyof KeysPairs as KeysPairs[K] extends [keyof TServices, string]
    ? KeysPairs[K][1]
    : never]: TServices[K extends string
    ? 0 extends keyof KeysPairs[K]
      ? KeysPairs[K][0] extends keyof TServices
        ? KeysPairs[K][0]
        : never
      : never
    : never];
};

/**
 * Creates proxy object, that allows to get container entries by properties getters.
 * Allows to represent your container as service with different methods and properties,
 * but internally it can be implemented with independent functions combined in container by composition.
 *
 * With options.keys you can explicitly define accessible keys or rewrite some of them.
 * if this option omitted - all keys from container will be accessible.
 * @example
 * ```
 * const domainContainer = new DIContainer()
 *  .addSingleton('config', readEnv)
 *  .addSingleton('privateService', createInternalPrivateService, ['config'])
 *  .addSingleton('serviceA', construct(ServiceAClass));
 *  .addSingleton(
 *    'doBusiness',
 *    (serviceA, config) =>
 *      (businessParams) => serviceA.method(config.PREFERENCE, businessParams),
 *    ['serviceA', 'config']
 *  );
 *
 * const domainService = createProxyAccessor(domainContainer, ['serviceA', ['doBusiness', 'publicNameFromBusinessFunction']]);
 *
 * expect(proxy.privateService instanceof ServiceAClass).to.be.false; // it is undefined in fact, not exposed
 * expect(proxy.serviceA instanceof ServiceAClass).to.be.true;
 * expect(typeof proxy.doBusiness).to.be.eq('undefined'); // it is exposed as publicNameFromBusinessFunction
 * expect(typeof proxy.publicNameFromBusinessFunction).to.be.eq('function');
 * ```
 * @param c {DIContainer<Entries>}
 * @param options {{ allowUnresolved?: boolean; keys?: (string | [string, string])[]; }}
 * @returns service {Entries}
 */
export const createProxyAccessor = <
  C extends IDIContainer<any>,
  Services extends ContainerServices<C>,
  NewKey extends ArgumentsKey,
  K extends readonly (keyof Services | [keyof Services, NewKey])[],
  O extends ProxyAccessorOptions<ContainerServices<C>, NewKey, K>,
>(
  c: C,
  options?: O,
): O['keys'] extends Array<any>
  ? KeysOverride<ContainerServices<C>, O['keys']>
  : Readonly<ContainerServices<C>> => {
  let getContainerKey: (k: ArgumentsKey) => ArgumentsKey | undefined;
  if (options?.keys) {
    const overridesMap = new Map(
      options.keys?.map((k: any) => (Array.isArray(k) ? [k[1], k[0]] : [k, k])),
    );
    getContainerKey = (k: any) => overridesMap.get(k);
  } else {
    getContainerKey = (k: any) => k;
  }
  return new Proxy({} as any, {
    get: (target, p) =>
      c.get(getContainerKey(p)!, {
        allowUnresolved: options?.allowUnresolved ?? true,
      }),
    set: () => {
      // todo: Can be used as addInstance with replacement.
      throw new Error('Set through proxy is not supported');
    },
  });
};
