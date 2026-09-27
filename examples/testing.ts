import { DIContainer, setCacheInstance } from 'injecute';

class Database {
  constructor(readonly url: string) {}
}
class UserService {
  constructor(readonly db: Database) {}
}

function createApp() {
  return new DIContainer()
    .addInstance('dbUrl', 'postgres://prod')
    .addSingleton('db', Database, ['dbUrl'])
    .addSingleton('users', UserService, ['db']);
}

// #region isolated-fork
const app = createApp();

// Everything the test resolves is built inside the fork, with the fake database.
await using testContainer = app
  .fork({ isolated: true })
  .addInstance('db', new Database('memory://'), { replace: true });

testContainer.get('users').db.url; // "memory://"
app.get('users').db.url; // "postgres://prod": the app is untouched
// #endregion isolated-fork

// #region set-cache-instance
// Or override one cached value on the container itself, until reset():
const other = createApp();
setCacheInstance(other, 'db', new Database('memory://'));
other.get('users').db.url; // "memory://"
other.reset();
// #endregion set-cache-instance

export { app, testContainer, other };
