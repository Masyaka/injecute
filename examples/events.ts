import { DIContainer } from 'injecute';

export const events: string[] = [];

// #region events
const app = new DIContainer()
  .addEventListener('add', ({ key }) => events.push(`added ${String(key)}`))
  .addEventListener('produce', ({ key }) =>
    events.push(`created ${String(key)}`),
  )
  .addEventListener('dispose', () => events.push('disposed'))
  .addSingleton('db', () => ({ connected: true }));

app.get('db'); // "created db"
app.get('db'); // cached: no event
// #endregion events

export { app };
