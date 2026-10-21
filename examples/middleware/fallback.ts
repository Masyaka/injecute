import { DIContainer } from 'injecute';

// #region fallback
// Resolve `env.*` keys from the environment when nothing is registered under them.
const env: Record<string, string> = { PORT: '8080' };

const app = new DIContainer().use((key, next) => {
  const value = next();
  if (
    value === undefined &&
    typeof key === 'string' &&
    key.startsWith('env.')
  ) {
    return env[key.slice('env.'.length)];
  }
  return value;
});

// Keys a middleware provides are not in the container's type; declare them where you use them:
const port = app.get('env.PORT' as never) as string; // "8080"
// #endregion fallback

export { app, port };
