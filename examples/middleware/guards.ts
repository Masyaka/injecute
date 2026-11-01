import { DIContainer, InjecuteError } from 'injecute';

// #region guards
// Request-scoped services must never be resolved from the root container.
const root = new DIContainer()
  .addSingleton('config', () => ({ region: 'eu' }))
  .use((key, next, { container }) => {
    if (
      typeof key === 'string' &&
      key.startsWith('request.') &&
      container === root
    ) {
      throw new Error(
        `"${key}" is request-scoped: resolve it from a request fork`,
      );
    }
    return next();
  });

const request = root.fork().addInstance('request.user', { id: 42 });
request.get('request.user'); // ok
// root.get('request.user' as never) would throw
// #endregion guards

export { root, request, InjecuteError };
