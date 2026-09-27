import { DIContainer, InjecuteError } from 'injecute';

// #region errors
const app = new DIContainer()
  .addInstance('logger', console)
  .addSingleton('service', (logger) => ({ logger }), ['logger']);

export function resolve(key: string): unknown {
  try {
    return app.get(key as never);
  } catch (error) {
    if (
      error instanceof InjecuteError &&
      error.code === 'INJECUTE_NOT_REGISTERED'
    ) {
      // error.message: No service registered for "loger" (searched this container). Did you mean "logger"?
      // error.path, error.docs (a link to the error's page)
      return undefined;
    }
    throw error;
  }
}
// #endregion errors

export { app };
