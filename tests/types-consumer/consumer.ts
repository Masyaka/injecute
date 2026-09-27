// Compiled by tests/types-consumer/run.mjs against the packed tarball with skipLibCheck: false,
// on the oldest supported TypeScript version and the latest one. Keep it using every public API.
import {
  addNamedResolvers,
  buildServicesGraph,
  construct,
  createNamedResolvers,
  createProxyAccessor,
  createResolversTuple,
  defer,
  DIContainer,
  optional,
  preload,
  setCacheInstance,
  type Middleware,
  type ServiceProvider,
  type ServiceRegistry,
} from 'injecute';

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

const timing: Middleware = (_key, next, { depth }) =>
  depth >= 0 ? next() : undefined;

const addBilling = (c: ServiceRegistry<{ url: string }>) =>
  c.addSingleton('billing', (url) => url.length, ['url']);

const app = new DIContainer()
  .addInstance('url', 'postgres://')
  .addSingleton('logger', Logger)
  .addSingleton('repo', Repo, ['logger', 'url'])
  .addSingleton('legacyRepo', construct(Repo), ['logger', 'url'])
  .addSingleton('maybe', (m) => m, [optional('missing')])
  .addSingleton('conn', () => ({ close() {} }), {
    dependencies: [],
    dispose: (conn) => conn.close(),
  })
  .addAlias('log', 'logger')
  .addTransient(
    'asyncUrl',
    defer((repo: Repo) => repo.url),
    ['repo'],
  )
  .extend(addBilling)
  .namespace('Domain', (d) =>
    d.addSingleton('svc', (repo) => ({ repo }), ['repo']),
  )
  .use(timing);

const repo: Repo = app.get('repo');
const logger: Logger = app.get('log');
const maybe: undefined = app.get('maybe');
const asyncUrl: Promise<string> = app.get('asyncUrl');
const billing: number = app.get('billing');
const svc: { repo: Repo } = app.get('Domain.svc');
const [getRepo] = createResolversTuple(app, ['repo']);
const named = createNamedResolvers(app, ['url', ['logger', 'lg']]);
const lg: Logger = named.lg();
const proxy = createProxyAccessor(app, { keys: ['repo', ['url', 'dsn']] });
const dsn: string = proxy.dsn;
preload(app, ['repo']);
setCacheInstance(app, 'url', 'mysql://');
const graph = buildServicesGraph(app);
const shared = new DIContainer().extend(
  addNamedResolvers(createNamedResolvers(app, ['url'])),
);
const sharedUrl: string = shared.get('url');
const scope = app.fork({ isolated: true }).addInstance('request', { id: 1 });
const id: number = scope.get('request').id;
const consume = (p: ServiceProvider<{ url: string }>) => p.get('url');
consume(app);
void app.dispose();

// @ts-expect-error unknown key
app.get('nope');
// @ts-expect-error wrong dependency type
app.addSingleton('bad', (n: number) => n, ['url']);
// @ts-expect-error a provider cannot register
(app as ServiceProvider<{ url: string }>).addInstance('x', 1);

export {
  repo,
  logger,
  maybe,
  asyncUrl,
  billing,
  svc,
  getRepo,
  lg,
  dsn,
  graph,
  sharedUrl,
  id,
};
