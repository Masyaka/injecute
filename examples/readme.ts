// The example from the README, runnable: a module with an extension point, a server started and stopped
// by the lifecycle, a scope per request, and an isolated fork for tests. The Console tab shows the order.
import {
  collect,
  createTag,
  DIContainer,
  startable,
  startLifecycle,
  type ServiceRegistry,
} from 'injecute';

export const log: string[] = [];

// Your classes stay plain: no decorators, no container imports.
class Transaction {
  #committed = false;
  commit(): void {
    this.#committed = true;
    log.push('tx: commit');
  }
  [Symbol.dispose](): void {
    if (!this.#committed) log.push('tx: rollback');
  }
}

class Database {
  constructor(readonly url: string) {}
  begin(): Transaction {
    return new Transaction();
  }
  async [Symbol.asyncDispose](): Promise<void> {
    log.push(`db closed: ${this.url}`);
  }
}

class UserRepository {
  constructor(private readonly db: Database) {}
  findAll(): string[] {
    return this.db.url === 'memory' ? ['test-user'] : ['alice', 'bob'];
  }
}

interface Route {
  readonly path: string;
  handle(): unknown;
}

class HttpServer {
  constructor(private readonly routes: Route[]) {}
  listen(port: number): void {
    log.push(
      `listening on ${port}: ${this.routes.map((r) => r.path).join(', ')}`,
    );
  }
  async close(): Promise<void> {
    log.push('server closed');
  }
}

// ① An extension point: modules add routes without importing the server.
const route = createTag('route').of<Route>();

// ② A module asks only for what it needs.
const addUsers = (c: ServiceRegistry<{ db: Database }>) =>
  c
    .addSingleton('repo', UserRepository, ['db'])
    .addSingleton(
      route('list'),
      (repo): Route => ({ path: '/users', handle: () => repo.findAll() }),
      ['repo'],
    );

// ③ The composition root: every dependency is a key you review in a diff.
export const app = new DIContainer()
  .addInstance('dbUrl', 'postgres://localhost/app')
  .addSingleton('db', Database, ['dbUrl']) // ['dbUlr'] → compile error: Did you mean '"dbUrl"'?
  .namespace('Users', addUsers) // fails to compile if the app has no `db`
  .extend(
    startable('server', HttpServer, [collect(route)], {
      start: (server) => server.listen(3000),
      stop: (server) => server.close(),
    }),
  )
  .seal();

// ④ Types are inferred from the registrations.
export const users = app.get('Users.repo').findAll(); // UserRepository

// ⑤ A scope per request: its own transaction, on top of the app's services.
export async function handle(fail: boolean): Promise<void> {
  await using scope = app.fork().addSingleton('tx', (db) => db.begin(), ['db']);
  const tx = scope.get('tx');
  if (fail) return; // disposing the scope rolls the transaction back
  tx.commit();
}

// ⑥ Start the server. In a real app: process.once('SIGTERM', () => running.stop()).
const running = await startLifecycle(app);

// ⑦ In tests: replace the database for the whole graph, without touching `app`.
export async function testUsers(): Promise<string[]> {
  await using test = app
    .fork({ isolated: true })
    .addInstance('db', new Database('memory'), { replace: true });
  return test.get('Users.repo').findAll();
}

await handle(false);
await handle(true);
export const testResult = await testUsers();
await running.stop(); // stops the server, then closes the database

console.log(log.join('\n'));

export default app;
