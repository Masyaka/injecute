// Type-level tests. Checked by `npm run typecheck` (tsc), not executed.
import { expectTypeOf } from 'vitest';
import {
  createProxyAccessor,
  createResolversTuple,
  DIContainer,
  optional,
  type ContainerServices,
  type Middleware,
  type Namespace,
  type SealedDIContainer,
  type NamespaceServices,
  type ServiceProvider,
  type ServiceRegistry,
  type ServiceType,
} from '../../src/index.ts';

class Logger {
  log(message: string): string {
    return message;
  }
}
class Repo {
  constructor(
    readonly logger: Logger,
    readonly url: string,
  ) {}
}

const app = new DIContainer()
  .addInstance('url', 'postgres://')
  .addSingleton('logger', Logger)
  .addSingleton('repo', Repo, ['logger', 'url'])
  .addTransient('count', (repo) => repo.url.length, ['repo'])
  .addSingleton('withOptions', (url) => ({ url }), {
    dependencies: ['url'],
    dispose: (instance) => {
      expectTypeOf(instance).toEqualTypeOf<{ url: string }>();
    },
  })
  .addSingleton('maybe', (missing, url) => [missing, url] as const, [
    optional('missing'),
    optional('url'),
  ])
  .addAlias('log', 'logger');

// ---- inference
expectTypeOf(app.get('repo')).toEqualTypeOf<Repo>();
expectTypeOf(app.get('count')).toEqualTypeOf<number>();
expectTypeOf(app.get('withOptions')).toEqualTypeOf<{ url: string }>();
expectTypeOf(app.get('maybe')).toEqualTypeOf<
  readonly [undefined, string | undefined]
>();
expectTypeOf(app.get('log')).toEqualTypeOf<Logger>();
expectTypeOf(app.get('url', { optional: true })).toEqualTypeOf<
  string | undefined
>();
expectTypeOf(app.createResolver('repo')).toEqualTypeOf<() => Repo>();
expectTypeOf(app.injecute(Repo, ['logger', 'url'])).toEqualTypeOf<Repo>();
expectTypeOf(app.bind(['url'], (url) => url.length)).toEqualTypeOf<
  () => number
>();
expectTypeOf(app.fork({ isolated: true }).get('repo')).toEqualTypeOf<Repo>();
expectTypeOf(
  app.addInstance('greet', (name: string) => `hi ${name}`).call('greet', ['x']),
).toEqualTypeOf<string>();

// ---- async singletons: get() keeps the promise, disposers receive the resolved value
const withAsync = new DIContainer()
  .addSingleton('pool', async () => ({ end: () => {} }), {
    dependencies: [],
    dispose: (pool) => {
      expectTypeOf(pool).toEqualTypeOf<{ end: () => void }>();
    },
  })
  .addInstance('conn', Promise.resolve(1), {
    dispose: (conn) => {
      expectTypeOf(conn).toEqualTypeOf<number>();
    },
  });
expectTypeOf(withAsync.get('pool')).toEqualTypeOf<
  Promise<{ end: () => void }>
>();
expectTypeOf(withAsync.get('conn')).toEqualTypeOf<Promise<number>>();

// ---- modules: inline, and non-generic ones that declare only what they need
const extended = app.extend((c) =>
  c.addSingleton('extra', (repo) => repo.url, ['repo']),
);
expectTypeOf(extended.get('extra')).toEqualTypeOf<string>();
expectTypeOf(extended.get('repo')).toEqualTypeOf<Repo>();

const addBilling = (c: ServiceRegistry<{ url: string }>) =>
  c.addSingleton('billing', (url) => url.length, ['url']);
expectTypeOf(app.extend(addBilling).get('billing')).toEqualTypeOf<number>();
expectTypeOf(app.extend(addBilling).get('repo')).toEqualTypeOf<Repo>();

// ---- namespaces
const withNamespace = app.namespace('Domain', (domain) =>
  domain
    .addSingleton('service', (repo) => ({ repo }), ['repo'])
    .addInstance('flag', true),
);
expectTypeOf(withNamespace.get('Domain.service')).toEqualTypeOf<{
  repo: Repo;
}>();
expectTypeOf(withNamespace.get('Domain.flag')).toEqualTypeOf<boolean>();
expectTypeOf(withNamespace.get('Domain').get('flag')).toEqualTypeOf<boolean>();
expectTypeOf(
  app.namespace('Billing', addBilling).get('Billing.billing'),
).toEqualTypeOf<number>();

// nested namespaces: the map keeps each service once, under its full key, and a marker per namespace
const nested = app.namespace('Outer', (outer) =>
  outer
    .addInstance('top', 1)
    .namespace('Inner', (inner) =>
      inner
        .addSingleton('deep', (url) => ({ url }), ['url'])
        .namespace('Core', (core) => core.addInstance('leaf', true)),
    ),
);
expectTypeOf<
  ContainerServices<typeof nested>['Outer']
>().toEqualTypeOf<Namespace>();
expectTypeOf<
  ContainerServices<typeof nested>['Outer.Inner.Core']
>().toEqualTypeOf<Namespace>();
expectTypeOf(nested.get('Outer.Inner.Core.leaf')).toEqualTypeOf<boolean>();
expectTypeOf(nested.get('Outer.Inner.deep')).toEqualTypeOf<{ url: string }>();
expectTypeOf(
  nested.get('Outer').get('Inner').get('Core').get('leaf'),
).toEqualTypeOf<boolean>();
expectTypeOf(
  nested.get('Outer.Inner').get('Core.leaf'),
).toEqualTypeOf<boolean>();
expectTypeOf(nested.get('Outer.Inner.Core')).toEqualTypeOf<
  ServiceProvider<{ leaf: boolean }>
>();
expectTypeOf<NamespaceServices<typeof nested, 'Outer.Inner'>>().toEqualTypeOf<{
  deep: { url: string };
  Core: Namespace;
  'Core.leaf': boolean;
}>();
// @ts-expect-error not a key of the namespace
nested.get('Outer').get('leaf');
// @ts-expect-error the root's services are not part of the namespace provider
nested.get('Outer').get('url');

// a namespace used as a dependency, alias, resolver or accessor property is its provider
nested.addSingleton(
  'usesOuter',
  (outer) => {
    expectTypeOf(outer.get('top')).toEqualTypeOf<number>();
    return outer;
  },
  ['Outer'],
);
expectTypeOf(
  nested.addAlias('O', 'Outer').get('O').get('Inner.Core.leaf'),
).toEqualTypeOf<boolean>();
expectTypeOf(
  createResolversTuple(nested, ['Outer'])[0]().get('top'),
).toEqualTypeOf<number>();
expectTypeOf<
  ServiceType<ContainerServices<typeof nested>, 'Outer.Inner.Core'>
>().toEqualTypeOf<ServiceProvider<{ leaf: boolean }>>();
expectTypeOf(
  createProxyAccessor(nested)['Outer'].get('top'),
).toEqualTypeOf<number>();

// a callback returns the registry it received
// @ts-expect-error an unrelated container is not the registry
app.extend(() => new DIContainer().addInstance('other', 1));
// @ts-expect-error an unrelated container is not the registry
app.namespace('Other', () => new DIContainer().addInstance('other', 1));

// consumers can require namespaced services by their full key
const needsLeaf = (p: ServiceProvider<{ 'Outer.Inner.Core.leaf': boolean }>) =>
  p.get('Outer.Inner.Core.leaf');
needsLeaf(nested);
needsLeaf(nested.fork());

// `any`, `unknown` and `never` services are not mistaken for namespaces
const odd = new DIContainer()
  .addInstance('anything', JSON.parse('1') as any)
  .addInstance('unknown', 1 as unknown)
  .addInstance('never', undefined as never);
expectTypeOf(odd.get('anything')).toBeAny();
expectTypeOf(odd.get('unknown')).toBeUnknown();
expectTypeOf(odd.get('never')).toBeNever();

// ---- registering a key again replaces its type (it used to intersect, often into never)
const relabeled = new DIContainer()
  .addInstance('label', 'x')
  .addInstance('other', true)
  .addSingleton('label', (label) => label.length, {
    replace: true,
    dependencies: ['label'],
  });
expectTypeOf(relabeled.get('label')).toEqualTypeOf<number>();
expectTypeOf(relabeled.get('other')).toEqualTypeOf<boolean>();
expectTypeOf(
  relabeled.addInstance('label', [1], { replace: true }).get('label'),
).toEqualTypeOf<number[]>();
// an override in a fork
expectTypeOf(
  app
    .fork({ isolated: true })
    .addInstance('url', 42, { replace: true })
    .get('url'),
).toEqualTypeOf<number>();
// a module that decorates a service of the container keeps its type; one that changes the type
// intersects it with the container's (extend() does not merge, to keep typechecking cheap)
const decorateUrl = (c: ServiceRegistry<{ url: string }>) =>
  c.addSingleton('url', (url) => url.trim(), {
    replace: true,
    dependencies: ['url'],
  });
expectTypeOf(app.extend(decorateUrl).get('url')).toEqualTypeOf<string>();
expectTypeOf(app.extend(decorateUrl).get('repo')).toEqualTypeOf<Repo>();
// inside a module, replacing its own service changes the type
app.extend((c) => {
  const inner = c
    .addInstance('step', 'one')
    .addInstance('step', 2, { replace: true });
  expectTypeOf(inner.get('step')).toEqualTypeOf<number>();
  expectTypeOf(inner.get('url')).toEqualTypeOf<string>();
  return inner;
});
// an alias to a replaced service follows the new type
expectTypeOf(relabeled.addAlias('l', 'label').get('l')).toEqualTypeOf<number>();

// ---- registries keep the services they were given (S) apart from the ones they add (A)
const addReports = (c: ServiceRegistry<{ url: string }>) =>
  c.addSingleton('reports', (url) => [url], ['url']).addInstance('limit', 10);
expectTypeOf(addReports).returns.toEqualTypeOf<
  ServiceRegistry<{ url: string }, { reports: string[] } & { limit: number }>
>();
expectTypeOf<ContainerServices<ReturnType<typeof addReports>>>().toEqualTypeOf<
  { url: string } & { reports: string[] } & { limit: number }
>();
expectTypeOf(app.extend(addReports).get('reports')).toEqualTypeOf<string[]>();
app.extend((c) => {
  const added = c
    .addInstance('own', 1)
    // own additions resolve like given services, and shadow them
    .addSingleton('both', (own, url) => ({ own, url }), ['own', 'url'])
    .addSingleton('url', (url) => url.length, {
      replace: true,
      dependencies: ['url'],
    })
    .addAlias('ownAlias', 'own')
    .addSingleton('maybeOwn', (o) => o, [optional('own')])
    .namespace('Inner', (inner) =>
      // a nested callback sees the given services and the ones added so far
      inner.addSingleton('pair', (own, repo) => ({ own, repo }), [
        'own',
        'repo',
      ]),
    );
  expectTypeOf(added.get('both')).toEqualTypeOf<{ own: number; url: string }>();
  expectTypeOf(added.get('ownAlias')).toEqualTypeOf<number>();
  expectTypeOf(added.get('maybeOwn')).toEqualTypeOf<number | undefined>();
  expectTypeOf(added.get('Inner.pair')).toEqualTypeOf<{
    own: number;
    repo: Repo;
  }>();
  expectTypeOf(
    added.injecute((own) => own + 1, ['own']),
  ).toEqualTypeOf<number>();
  expectTypeOf(added.bind(['both'], (both) => both.own)).toEqualTypeOf<
    () => number
  >();
  return added;
});
// a container is a registry that was given nothing and added everything
expectTypeOf(app).toExtend<
  ServiceRegistry<{}, ContainerServices<typeof app>>
>();

// ---- seal(): no registration methods, one flat service map, open forks
const sealed = app.seal();
expectTypeOf(sealed.get('repo')).toEqualTypeOf<Repo>();
expectTypeOf(sealed.get('log')).toEqualTypeOf<Logger>();
expectTypeOf<ContainerServices<typeof sealed>>().toEqualTypeOf<{
  [K in keyof ContainerServices<typeof app>]: ContainerServices<typeof app>[K];
}>();
// @ts-expect-error a sealed container registers nothing
sealed.addInstance('x', 1);
// @ts-expect-error no modules either
sealed.extend((c) => c);
// @ts-expect-error no namespaces
sealed.namespace('X', (x) => x);
// chained owner methods keep the sealed type
// @ts-expect-error still sealed after use()
sealed.use((_key, next) => next()).addInstance('x', 1);
expectTypeOf(sealed.reset()).toEqualTypeOf(sealed);
const sealedScope = sealed.fork().addInstance('requestId', 'r');
expectTypeOf(sealedScope.get('requestId')).toEqualTypeOf<string>();
expectTypeOf(sealedScope.get('repo')).toEqualTypeOf<Repo>();
expectTypeOf(
  sealed
    .fork({ isolated: true })
    .addInstance('url', 1, { replace: true })
    .get('url'),
).toEqualTypeOf<number>();
expectTypeOf(sealed).toExtend<ServiceProvider<{ url: string }>>(); // a sealed container is a provider
expectTypeOf(sealed).not.toExtend<ServiceRegistry<{ url: string }>>();
expectTypeOf(
  new DIContainer()
    .namespace('N', (n) => n.addInstance('x', 1))
    .seal()
    .get('N')
    .get('x'),
).toEqualTypeOf<number>();

// a named service map and seal() combine (the TypeScript guide's recipe for exported containers)
interface SealedServices extends ContainerServices<typeof app> {}
const namedSealed: SealedDIContainer<SealedServices> = app.fork().seal();
expectTypeOf(namedSealed.get('repo')).toEqualTypeOf<Repo>();

// ---- roles (§4.2.1): capability restrictions
const provider = (p: ServiceProvider<{ url: string }>) => p.get('url');
provider(app); // a provider of more services is assignable to a provider of fewer
provider(app.fork());
provider(extended);
provider(withNamespace);

const moduleCannotConfigure = (c: ServiceRegistry<{ url: string }>) => {
  // @ts-expect-error modules cannot add middlewares
  c.use((_key, next) => next());
  // @ts-expect-error modules cannot dispose
  void c.dispose();
  // @ts-expect-error modules cannot fork
  c.fork();
  return c;
};
void moduleCannotConfigure;

const consumerCannotRegister = (p: ServiceProvider<{ url: string }>) => {
  // @ts-expect-error consumers cannot register
  p.addInstance('x', 1);
  // @ts-expect-error consumers cannot run factories through the provider
  p.injecute((url: string) => url, ['url']);
};
void consumerCannotRegister;

const readOnlyContext: Middleware = (_key, next, { container }) => {
  // @ts-expect-error resolution-time code is read-only
  container.addInstance('x', 1);
  return next();
};
void readOnlyContext;

// @ts-expect-error no upward capability leak through getParent()
app.fork().getParent()!.addInstance('x', 1);

// @ts-expect-error a namespace provider from get() is read-only
withNamespace.get('Domain').addInstance('x', 1);

// the composition-root chain keeps every capability (A1)
expectTypeOf(
  new DIContainer()
    .addInstance('a', 1)
    .use((_k, next) => next())
    .get('a'),
).toEqualTypeOf<number>();
