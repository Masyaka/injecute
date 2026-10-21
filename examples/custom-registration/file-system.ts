import { readdir } from 'node:fs/promises';
import { DIContainer, type ServiceRegistry } from 'injecute';

// #region add-service-files
/** A file in the services directory: the file name is the key, the default export the factory. */
interface ServiceFile {
  default: (...args: any[]) => unknown;
  dependencies?: string[];
}

type ServiceOf<F extends ServiceFile> = ReturnType<F['default']>;

/** Imports every service file in `directory`. */
async function loadServiceFiles(directory: URL) {
  const names = (await readdir(directory)).filter(
    (name) => /\.[jt]s$/.test(name) && !name.endsWith('.d.ts'),
  );
  return Promise.all(
    names.map(async (name) => ({
      key: name.replace(/\.[jt]s$/, ''),
      file: (await import(new URL(name, directory).href)) as ServiceFile,
    })),
  );
}

/**
 * A module that registers the loaded files as singletons. The compiler can't see the directory, so
 * `Services` declares what the files provide.
 */
function addServiceFiles<Services extends object, Requires extends object = {}>(
  files: { key: string; file: ServiceFile }[],
) {
  return (
    registry: ServiceRegistry<Requires>,
  ): ServiceRegistry<Requires, Services> => {
    const untyped = registry as unknown as ServiceRegistry<any>;
    for (const { key, file } of files) {
      untyped.addSingleton(key, file.default, file.dependencies ?? []);
    }
    return registry as unknown as ServiceRegistry<Requires, Services>;
  };
}
// #endregion add-service-files

// #region file-system
// Taken from the files' own types: a changed factory changes the service type here.
type Services = {
  clock: ServiceOf<typeof import('./services/clock.ts')>;
  greeter: ServiceOf<typeof import('./services/greeter.ts')>;
};

const files = await loadServiceFiles(new URL('./services/', import.meta.url));

const app = new DIContainer()
  .addInstance('config', { greeting: 'Hello' })
  .extend(addServiceFiles<Services, { config: { greeting: string } }>(files));

app.get('greeter').greet('Ada'); // "Hello, Ada (1970-01-01T00:00:00.000Z)"
// #endregion file-system

export { app };
