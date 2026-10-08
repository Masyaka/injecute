import { DIContainer, type Middleware } from 'injecute';

// #region test-doubles
const app = new DIContainer().addSingleton('clock', () => ({
  now: () => Date.now(),
}));

// A temporary override, removed after the test.
const fakes = new Map<PropertyKey, unknown>([['clock', { now: () => 0 }]]);
const withFakes: Middleware = (key, next) =>
  fakes.has(key) ? fakes.get(key) : next();

app.use(withFakes);
const frozen = app.get('clock').now(); // 0
app.unuse(withFakes);
const real = app.get('clock').now(); // the real clock again
// #endregion test-doubles

export { app, frozen, real };
