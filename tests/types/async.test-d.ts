// Type-level tests for the async container. Checked by `npm run typecheck` (tsc), not executed.
import { expectTypeOf } from 'vitest';
import {
  AsyncDIContainer,
  DIContainer,
  optional,
  preload,
  type AsyncServiceProvider,
  type AsyncServiceRegistry,
  type ContainerServices,
  type NamespaceServices,
  type ServiceProvider,
  type ServiceRegistry,
} from '../../src/index.ts';
import type { SET_CACHE_INSTANCE } from '../../src/internal.ts';

class Database {
  constructor(readonly url: string) {}
}
class Repo {
  constructor(readonly db: Database) {}
}

const app = new AsyncDIContainer()
  .addSingleton('url', async () => 'postgres://')
  .addSingleton('db', Database, ['url'])
  .addSingleton('repo', (db) => new Repo(db), ['db'])
  .addTransient('size', async (url) => url.length, ['url'])
  .addInstance('config', Promise.resolve({ port: 1 }), {
    dispose: (config) => {
      expectTypeOf(config).toEqualTypeOf<{ port: number }>();
    },
  })
  .addSingleton('pool', async () => ({ end: () => {} }), {
    dependencies: [],
    dispose: (pool) => {
      expectTypeOf(pool).toEqualTypeOf<{ end: () => void }>();
    },
  })
  .addSingleton('maybe', (a, b) => [a, b] as const, [
    optional('url'),
    optional('missing'),
  ])
  .addAlias('database', 'db')
  .addInstance('greet', (name: string) => `hi ${name}`);

// ---- the service map holds resolved types; resolutions are promises
expectTypeOf<ContainerServices<typeof app>['url']>().toEqualTypeOf<string>();
expectTypeOf(app.get('url')).toEqualTypeOf<Promise<string>>();
expectTypeOf(app.get('db')).toEqualTypeOf<Promise<Database>>();
expectTypeOf(app.get('repo')).toEqualTypeOf<Promise<Repo>>();
expectTypeOf(app.get('size')).toEqualTypeOf<Promise<number>>();
expectTypeOf(app.get('config')).toEqualTypeOf<Promise<{ port: number }>>();
expectTypeOf(app.get('database')).toEqualTypeOf<Promise<Database>>();
expectTypeOf(app.get('maybe')).toEqualTypeOf<
  Promise<readonly [string | undefined, undefined]>
>();
expectTypeOf(app.get('url', { optional: true })).toEqualTypeOf<
  Promise<string | undefined>
>();
expectTypeOf(app.createResolver('db')).toEqualTypeOf<() => Promise<Database>>();
expectTypeOf(app.call('greet', ['Ada'])).toEqualTypeOf<Promise<string>>();
expectTypeOf(app.injecute(Repo, ['db'])).toEqualTypeOf<Promise<Repo>>();
expectTypeOf(app.bind(['url'], async (url) => url.length)).toEqualTypeOf<
  () => Promise<number>
>();
expectTypeOf(app.fork().get('repo')).toEqualTypeOf<Promise<Repo>>();
expectTypeOf(app.fork({ isolated: true })).toEqualTypeOf<
  AsyncDIContainer<ContainerServices<typeof app>>
>();
expectTypeOf(app.dispose()).toEqualTypeOf<Promise<void>>();
expectTypeOf(preload(app)).toEqualTypeOf<Promise<void>>();

// ---- typos are reported on the key
// @ts-expect-error "Did you mean 'url'?"
app.addSingleton('bad', (u: string) => u, ['ur']);
// @ts-expect-error get() returns a promise
const notAPromise: Database = app.get('db');
void notAPromise;

// ---- modules and namespaces
const addBilling = (c: AsyncServiceRegistry<{ repo: Repo }>) =>
  c.addSingleton('invoices', async (repo) => ({ repo }), ['repo']);
const withBilling = app
  .extend(addBilling)
  .namespace('Audit', (audit) =>
    audit.addSingleton('log', (db) => [db.url], ['db']),
  );
expectTypeOf(withBilling.get('invoices')).toEqualTypeOf<
  Promise<{ repo: Repo }>
>();
expectTypeOf(withBilling.get('Audit.log')).toEqualTypeOf<Promise<string[]>>();
expectTypeOf(withBilling.get('Audit')).toEqualTypeOf<
  Promise<AsyncServiceProvider<{ log: string[] }>>
>();
expectTypeOf<NamespaceServices<typeof withBilling, 'Audit'>>().toEqualTypeOf<{
  log: string[];
}>();

// a module can't configure or own the container
app.extend((c) => {
  // @ts-expect-error modules cannot add middlewares
  c.use(() => undefined);
  // @ts-expect-error modules cannot dispose
  void c.dispose();
  return c;
});

// a module declaring services the container doesn't have is rejected
const needsCache = (c: AsyncServiceRegistry<{ cache: Map<string, string> }>) =>
  c.addSingleton('cached', (cache) => cache.size, ['cache']);
// @ts-expect-error "injecute: extension requires services that are not registered": "cache"
app.extend(needsCache);

// sync modules don't apply to an async container (their get() type would be wrong), and vice versa
const syncModule = (c: ServiceRegistry<{ url: string }>) =>
  c.addSingleton('len', (url) => url.length, ['url']);
// @ts-expect-error a sync module on an async container
app.extend(syncModule);
const syncApp = new DIContainer().addInstance(
  'repo',
  new Repo(new Database('x')),
);
// @ts-expect-error an async module on a sync container
syncApp.extend(addBilling);

// ---- assignability: async and sync views don't mix
type AppServices = ContainerServices<typeof app>;
expectTypeOf(app).toExtend<AsyncServiceRegistry<AppServices, AppServices>>();
expectTypeOf(app).toExtend<AsyncServiceProvider<{ db: Database }>>();
expectTypeOf(app).not.toExtend<ServiceProvider<{ db: Database }>>();
expectTypeOf(app).not.toExtend<ServiceRegistry<{ db: Database }>>();
expectTypeOf(
  new DIContainer().addInstance('db', new Database('x')),
).not.toExtend<AsyncServiceProvider<{ db: Database }>>();

// a provider of more services is assignable to a provider of fewer (covariance)
declare const bigger: AsyncServiceProvider<{ db: Database; repo: Repo }>;
expectTypeOf(bigger).toExtend<AsyncServiceProvider<{ db: Database }>>();
expectTypeOf(app.fork()).toExtend<AsyncServiceProvider<{ repo: Repo }>>();

// ---- instanceof narrows
declare const unknownValue: unknown;
if (unknownValue instanceof AsyncDIContainer) {
  expectTypeOf(unknownValue).toEqualTypeOf<AsyncDIContainer<any>>();
}

// ---- drift guard: the async container has every public member of DIContainer, and no others
expectTypeOf<
  Exclude<
    keyof DIContainer<{}>,
    keyof AsyncDIContainer<{}> | typeof SET_CACHE_INSTANCE
  >
>().toEqualTypeOf<never>();
expectTypeOf<
  Exclude<keyof AsyncDIContainer<{}>, keyof DIContainer<{}>>
>().toEqualTypeOf<never>();
expectTypeOf<
  Exclude<keyof ServiceRegistry, keyof AsyncServiceRegistry>
>().toEqualTypeOf<never>();
expectTypeOf<
  Exclude<keyof ServiceProvider, keyof AsyncServiceProvider>
>().toEqualTypeOf<never>();
