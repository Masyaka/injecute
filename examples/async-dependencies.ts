import { defer, DIContainer } from 'injecute';

interface Config {
  dbUrl: string;
}
class Database {
  constructor(readonly url: string) {}
}

// #region defer
const app = new DIContainer()
  .addSingleton('config', async (): Promise<Config> => ({
    dbUrl: 'postgres://localhost',
  }))
  // defer(): awaits the promised arguments, so the factory receives the resolved config
  .addSingleton(
    'db',
    defer((config: Config) => new Database(config.dbUrl)),
    ['config'],
  );

export async function connect(): Promise<Database> {
  return app.get('db'); // Promise<Database>
}
// #endregion defer

export { app };
