import { DIContainer, type Middleware } from 'injecute';

export const lines: string[] = [];

// #region tracing
const tracing: Middleware = (key, next, { depth }) => {
  const start = performance.now();
  const value = next();
  const ms = (performance.now() - start).toFixed(1);
  lines.push(`${'  '.repeat(depth)}${String(key)} ${ms}ms`);
  return value;
};

const app = new DIContainer()
  .use(tracing)
  .addInstance('config', { url: 'postgres://localhost' })
  .addSingleton('db', (config) => ({ config }), ['config']);

app.get('db');
// lines: ["  config 0.0ms", "db 0.1ms"] (dependencies are nested)
// #endregion tracing

export { app };
