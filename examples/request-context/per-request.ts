import { AsyncLocalStorage } from 'node:async_hooks';
import { DIContainer } from 'injecute';
import type { ContextAccessor } from './app.ts';

// #region per-context
/** One value per context (per request): created on first use, forgotten with the context. */
export interface PerContext<T> {
  current(): T;
}

export function perContext<C extends object, T>(
  context: ContextAccessor<C>,
  create: () => T,
): PerContext<T> {
  const values = new WeakMap<C, T>();
  return {
    current() {
      const key = context.current();
      if (!key)
        throw new Error('No request context: call this inside a request');
      if (!values.has(key)) values.set(key, create());
      return values.get(key)!;
    },
  };
}
// #endregion per-context

export class Database {
  queries = 0;
  findUser(id: string) {
    this.queries++;
    return { id, name: `user ${id}` };
  }
}

class UserCache {
  readonly #users = new Map<string, { id: string; name: string }>();
  constructor(private readonly db: Database) {}
  get(id: string) {
    if (!this.#users.has(id)) this.#users.set(id, this.db.findUser(id));
    return this.#users.get(id)!;
  }
}

// #region per-request
const storage = new AsyncLocalStorage<{ traceId: string }>();

const app = new DIContainer()
  .addInstance('context', { current: () => storage.getStore() })
  .addSingleton('db', Database)
  // a singleton that hands out one cache per request
  .addSingleton(
    'users',
    (context, db) => perContext(context, () => new UserCache(db)),
    ['context', 'db'],
  )
  .addSingleton(
    'profiles',
    (users) => ({ name: (id: string) => users.current().get(id).name }),
    ['users'],
  );

export function handle(ids: string[]): string[] {
  // a new context object per request, so a new cache per request
  return storage.run({ traceId: crypto.randomUUID() }, () =>
    ids.map((id) => app.get('profiles').name(id)),
  );
}

handle(['1', '1', '2']); // 2 queries: the second "1" comes from the request's cache
handle(['1']); // 1 more query: a new request, a new cache
// #endregion per-request

export { app };
