import {
  AsyncDIContainer,
  preload,
  type AsyncServiceProvider,
  type AsyncServiceRegistry,
} from 'injecute';

interface Config {
  dbUrl: string;
}

const log: string[] = [];

class Pool {
  constructor(readonly url: string) {}
  async query(sql: string): Promise<string> {
    return `${this.url}: ${sql}`;
  }
  async [Symbol.asyncDispose]() {
    log.push(`close pool ${this.url}`);
  }
}

async function loadConfig(): Promise<Config> {
  return { dbUrl: 'postgres://localhost/app' };
}

async function connect(url: string): Promise<Pool> {
  return new Pool(url);
}

class UserRepository {
  constructor(readonly pool: Pool) {}
  findAll(): Promise<string> {
    return this.pool.query('select * from users');
  }
}

// #region container
const app = new AsyncDIContainer()
  .addSingleton('config', loadConfig) // Promise<Config> → registers Config
  .addSingleton('pool', (config) => connect(config.dbUrl), ['config']) // receives a Config
  .addSingleton('users', UserRepository, ['pool']); // receives a Pool

const users = await app.get('users'); // UserRepository
// #endregion container

// #region modules
// A module for an async container takes an AsyncServiceRegistry
const addReports = (c: AsyncServiceRegistry<{ users: UserRepository }>) =>
  c.addSingleton('reports', (users) => ({ weekly: () => users.findAll() }), [
    'users',
  ]);

// Code that only resolves services takes an AsyncServiceProvider
function createHandler(
  services: AsyncServiceProvider<{
    reports: { weekly: () => Promise<string> };
  }>,
) {
  return async () => (await services.get('reports')).weekly();
}

const withReports = app.extend(addReports);
const handler = createHandler(withReports);
// #endregion modules

// #region testing
const test = app
  .fork({ isolated: true })
  .addInstance('config', { dbUrl: 'postgres://test' }, { replace: true });
const testUsers = await test.get('users'); // built with the test config; app is untouched
// #endregion testing

// #region startup
async function start() {
  await preload(withReports); // creates every service now, so wiring errors surface at boot
}

async function shutdown() {
  await test.dispose();
  await app.dispose(); // closes the pool, once it is resolved
}
// #endregion startup

export { app, handler, log, shutdown, start, testUsers, users, UserRepository };
