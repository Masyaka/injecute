// Compiled by tests/types-consumer/run.mjs against the packed tarball with skipLibCheck: false,
// on the oldest supported TypeScript version and the latest one. Keep it using every public API.
import {
  construct,
  createNamedResolvers,
  createProxyAccessor,
  createResolversTuple,
  defer,
  DIContainer,
  preload,
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

const container = new DIContainer()
  .addInstance('url', 'postgres://')
  .addSingleton('logger', construct(Logger), [])
  .addSingleton('repo', construct(Repo), ['logger', 'url'])
  .addAlias('log', 'logger')
  .addTransient(
    'asyncUrl',
    defer((repo: Repo) => repo.url),
    ['repo'],
  )
  .extend((c) => c.addInstance('extra', 1));

const repo: Repo = container.get('repo');
const logger: Logger = container.get('log');
const asyncUrl: Promise<string> = container.get('asyncUrl');
const extra: number = container.get('extra');
const [getRepo] = createResolversTuple(container, ['repo']);
const named = createNamedResolvers(container, ['url', ['logger', 'lg']]);
const lg: Logger = named.lg();
const proxy = createProxyAccessor(container, {
  keys: ['repo', ['url', 'dsn']],
});
const dsn: string = proxy.dsn;
preload(container, ['repo']);
const child = container.fork().addInstance('request', { id: 1 });
const id: number = child.get('request').id;

// @ts-expect-error unknown key
container.get('nope');
// @ts-expect-error wrong dependency type
container.addSingleton('bad', (n: number) => n, ['url']);

export { repo, logger, asyncUrl, extra, getRepo, lg, dsn, id };
