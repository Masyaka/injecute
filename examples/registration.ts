import { construct, DIContainer, optional } from 'injecute';

class Clock {
  now(): number {
    return Date.now();
  }
}

// #region lifetimes
const lifetimes = new DIContainer()
  // created once, on first use, then cached
  .addSingleton('clock', Clock)
  // created again on every resolution
  .addTransient('requestId', () => crypto.randomUUID())
  // an existing value
  .addInstance('config', { port: 8080 });

lifetimes.get('clock') === lifetimes.get('clock'); // true
lifetimes.get('requestId') === lifetimes.get('requestId'); // false
// #endregion lifetimes

// #region dependencies
const withDependencies = new DIContainer()
  .addInstance('config', { port: 8080, debug: false })
  // keys are passed to the factory in the same order
  .addSingleton('address', (config) => `http://localhost:${config.port}`, [
    'config',
  ])
  // optional(key): the service when it is registered, undefined otherwise
  // a function dependency: its result, computed on each resolution
  .addSingleton(
    'banner',
    (address, transport, startedAt) =>
      `${address} via ${transport ?? 'console'} since ${startedAt}`,
    ['address', optional('transport'), () => new Date(0).toISOString()],
  );
// #endregion dependencies

// #region alias
const logging = new DIContainer()
  .addInstance('jsonLogger', { format: 'json' })
  .addInstance('prettyLogger', { format: 'pretty' })
  .addAlias(
    'logger',
    process.env.NODE_ENV === 'production' ? 'jsonLogger' : 'prettyLogger',
  );

logging.get('logger'); // the pretty logger outside production
// #endregion alias

// #region decorate
const decorated = new DIContainer()
  .addInstance('greeting', 'hello')
  // a dependency on the key being registered receives its previous definition
  .addSingleton('greeting', (greeting) => greeting.toUpperCase(), {
    replace: true,
    dependencies: ['greeting'],
  });

decorated.get('greeting'); // "HELLO"
// #endregion decorate

// #region construct
// Classes compiled to ES5 (or bound classes) look like plain functions:
// register them with construct() so they are called with `new`.
function LegacyClient(this: { url: string }, url: string) {
  this.url = url;
}
LegacyClient.prototype.ping = function () {
  return 'pong';
};

const legacy = new DIContainer()
  .addInstance('url', 'https://api.example.com')
  .addSingleton(
    'client',
    construct(LegacyClient as unknown as new (url: string) => { url: string }),
    ['url'],
  );
// #endregion construct

export { lifetimes, withDependencies, logging, decorated, legacy, Clock };
