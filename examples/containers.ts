import { DIContainer, type ServiceRegistry } from 'injecute';

class Database {
  constructor(readonly url: string) {}
}
class UserRepository {
  constructor(readonly db: Database) {}
}

// #region fork
const app = new DIContainer()
  .addInstance('dbUrl', 'postgres://prod')
  .addSingleton('db', Database, ['dbUrl'])
  .addSingleton('users', UserRepository, ['db']);

// A fork sees every service of its parent; what it adds stays in the fork.
const requestScope = app.fork().addInstance('requestId', 'req-1');
requestScope.get('users') === app.get('users'); // true: parent singletons are shared
// #endregion fork

// #region isolated
// An isolated fork runs every service it resolves itself, so overrides reach the whole graph
// and nothing leaks back into the parent.
const testScope = app
  .fork({ isolated: true })
  .addInstance('dbUrl', 'postgres://test', { replace: true });

testScope.get('users').db.url; // "postgres://test"
app.get('users').db.url; // "postgres://prod"
// #endregion isolated

// #region modules
// A module declares only the services it needs.
const addBilling = (c: ServiceRegistry<{ db: Database }>) =>
  c.addSingleton('invoices', (db) => ({ db, list: () => [] as string[] }), [
    'db',
  ]);

const withBilling = app.extend(addBilling); // type error if `db` were missing
withBilling.get('invoices');
// #endregion modules

// #region namespaces
const withNamespace = app.namespace('Reports', (reports) =>
  reports
    .addSingleton('daily', (users) => ({ users, kind: 'daily' }), ['users'])
    .addInstance('timezone', 'UTC'),
);

withNamespace.get('Reports.daily'); // { users, kind: 'daily' }
withNamespace.get('Reports').get('timezone'); // "UTC"
// #endregion namespaces

// #region adapt
interface Logger {
  info(message: string): void;
}

// The module declares the services it needs under its own keys.
const addAudit = (c: ServiceRegistry<{ dbUrl: string; log: Logger }>) =>
  c.addSingleton('audit', (dbUrl, log) => ({ dbUrl, log }), ['dbUrl', 'log']);

// The host has them under other keys, or in another shape.
const host = new DIContainer()
  .addInstance('config', { auditDb: 'postgres://audit' })
  .addInstance('logger', { info: () => {} } as Logger)
  .namespace('Audit', (audit) =>
    audit
      .addSingleton('dbUrl', (config) => config.auditDb, ['config']) // derive a value
      .addAlias('log', 'logger') // the same service under another key
      .extend(addAudit),
  );

host.get('Audit.audit').dbUrl; // "postgres://audit"
host.has('dbUrl'); // false: the adapters stay in the namespace
// #endregion adapt

// #region seal
// Register everything, then seal the composition root.
const root = new DIContainer()
  .addInstance('dbUrl', 'postgres://prod')
  .addSingleton('db', Database, ['dbUrl'])
  .addSingleton('users', UserRepository, ['db'])
  .seal();

root.get('users'); // resolves as before
// root.addInstance('flag', true); // type error, and INJECUTE_SEALED at runtime

// Per request or per test, fork it: forks are open for registrations.
const perRequest = root.fork().addInstance('requestId', 'req-2');
// #endregion seal

export {
  app,
  requestScope,
  testScope,
  withBilling,
  withNamespace,
  host,
  root,
  perRequest,
  Database,
};
