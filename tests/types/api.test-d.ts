// Type-level tests. Checked by `npm run typecheck` (tsc), not executed.
import { expectTypeOf } from 'vitest';
import {
  DIContainer,
  optional,
  type Middleware,
  type ServiceProvider,
  type ServiceRegistry,
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
