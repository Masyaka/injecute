// #region codegen
import { DIContainer } from 'injecute';
import { addServices } from './services.generated.ts';

const app = new DIContainer()
  .addInstance('config', { greeting: 'Hello' })
  .extend(addServices);

app.get('greeter').greet('Ada'); // "Hello, Ada (1970-01-01T00:00:00.000Z)"
// #endregion codegen

export { app };
