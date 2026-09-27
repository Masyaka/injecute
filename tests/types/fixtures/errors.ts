// Every line marked `// error: <code> <text>` must produce that TypeScript error (checked by
// tests/types/errors.test.ts). Keeps the error messages people and agents see readable.
import { DIContainer, type ServiceRegistry } from '../../../src/index.ts';

class Logger {
  log(message: string): string {
    return message;
  }
}
class Repo {
  constructor(
    readonly logger: Logger,
    readonly url: string,
  ) {}
}
abstract class Base {}

const app = new DIContainer()
  .addInstance('url', 'postgres://')
  .addSingleton('logger', Logger)
  .addSingleton('repo', Repo, ['logger', 'url']);

app.addSingleton('typo', (l: Logger) => l, ['loger']); // error: TS2820 Did you mean '"logger"'?
app.injecute((l: Logger) => l, ['loger']); // error: TS2820 Did you mean '"logger"'?
app.addSingleton('wrongType', (l: string) => l, ['logger']); // error: TS2345 '(l: string) => string' is not assignable
app.addSingleton('swapped', Repo, ['url', 'logger']); // error: TS2345 'typeof Repo' is not assignable
app.addSingleton('abstract', Base, []); // error: TS2345 'typeof Base' is not assignable
app.addSingleton('missingDependencies', (l: Logger) => l); // error: TS2345 '(l: Logger) => Logger' is not assignable
app.extend((c: ServiceRegistry<{ db: string }>) => c); // error: TS2345 'injecute: extension requires services that are not registered': "db"
app.get('nope'); // error: TS2345 Argument of type '"nope"' is not assignable
app.addInstance('greet', (n: string) => n).call('url', ['x']); // error: TS2345 not assignable to parameter of type 'never'
