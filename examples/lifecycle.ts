import { DIContainer } from 'injecute';

export const log: string[] = [];

class Pool {
  constructor(readonly url: string) {}
  async [Symbol.asyncDispose](): Promise<void> {
    log.push(`close pool ${this.url}`);
  }
}

class Cache {
  [Symbol.dispose](): void {
    log.push('clear cache');
  }
}

// #region dispose
const app = new DIContainer()
  .addInstance('url', 'postgres://localhost/app')
  .addSingleton('pool', Pool, ['url']) // disposed with [Symbol.asyncDispose]
  .addSingleton('cache', Cache) // disposed with [Symbol.dispose]
  .addSingleton('mailer', () => ({ close: () => log.push('close mailer') }), {
    dependencies: [],
    dispose: (mailer) => mailer.close(), // custom disposer
  });

export async function shutdown(): Promise<void> {
  app.get('pool');
  app.get('cache');
  app.get('mailer');
  // dependents first: reverse creation order
  await app.dispose();
}
// #endregion dispose

// #region await-using
export async function handleRequest(requestId: string): Promise<string> {
  await using scope = app.fork().addSingleton('trace', () => ({
    id: requestId,
    [Symbol.dispose]: () => log.push(`end ${requestId}`),
  }));
  return scope.get('trace').id;
  // `trace` is disposed here; the app's singletons stay alive
}
// #endregion await-using

export { app };
