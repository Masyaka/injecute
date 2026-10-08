// Deno imports the TypeScript sources directly (the same files JSR publishes).
import { construct, DIContainer } from '../../src/index.ts';

class Repo {
  constructor(readonly db: string) {}
}
const container = new DIContainer()
  .addInstance('db', 'postgres://')
  .addSingleton('repo', construct(Repo), ['db']);
if (container.get('repo').db !== 'postgres://') throw new Error('wrong repo');
console.log('ok');
