// #region example
import { DIContainer } from 'injecute';

class Database {
  constructor(readonly url: string) {}
  query(sql: string): string[] {
    return [`${this.url}: ${sql}`];
  }
}

class UserRepository {
  constructor(private readonly db: Database) {}
  findAll(): string[] {
    return this.db.query('select * from users');
  }
}

const app = new DIContainer()
  .addInstance('dbUrl', 'postgres://localhost/app')
  .addSingleton('db', Database, ['dbUrl'])
  .addSingleton('users', UserRepository, ['db']);

const users = app.get('users'); // typed as UserRepository
users.findAll();
// #endregion example

export { app, users, UserRepository };
