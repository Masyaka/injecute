import { DIContainer } from 'injecute';

interface Request {
  headers: Record<string, string | undefined>;
}

class Users {
  find(id: string) {
    return { id, name: `user ${id}` };
  }
}

// #region request-scope
const app = new DIContainer().addSingleton('users', Users);

// One fork per request: request-specific services stay in the fork and are disposed with it.
export async function handle(request: Request): Promise<string> {
  await using scope = app
    .fork()
    .addInstance('request', request)
    .addSingleton(
      'currentUser',
      (request, users) =>
        users.find(request.headers['x-user-id'] ?? 'anonymous'),
      ['request', 'users'],
    );
  return `hello ${scope.get('currentUser').name}`;
}
// #endregion request-scope

export { app };
