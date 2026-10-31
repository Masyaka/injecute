import { readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { relative, dirname } from 'node:path';

// #region generate-wiring
/** A file in the services directory: the file name is the key, the default export the factory. */
interface ServiceFile {
  default: (...args: any[]) => unknown;
  dependencies?: readonly string[];
}

/**
 * Writes a wiring file with one `addSingleton()` per file in `directory`, dependencies first. Keys
 * that no file provides become the module's requirements, typed from the factory parameters that
 * receive them.
 */
export async function generateWiring(
  directory: URL,
  output: URL,
): Promise<string> {
  const names = (await readdir(directory))
    .filter((name) => /\.[jt]s$/.test(name) && !name.endsWith('.d.ts'))
    .sort();
  const services = new Map<string, { path: string; dependencies: string[] }>();
  for (const name of names) {
    const url = new URL(name, directory);
    const file = (await import(url.href)) as ServiceFile;
    let path = relative(dirname(fileURLToPath(output)), fileURLToPath(url));
    if (!path.startsWith('.')) path = `./${path}`;
    const key = name.replace(/\.[jt]s$/, '');
    services.set(key, { path, dependencies: [...(file.dependencies ?? [])] });
  }

  // A service is registered after the services it depends on, so each line type-checks.
  const order: string[] = [];
  const visiting = new Set<string>();
  const visit = (key: string, path: string[]) => {
    if (order.includes(key) || !services.has(key)) return;
    if (visiting.has(key))
      throw new Error(`Circular dependency: ${[...path, key].join(' -> ')}`);
    visiting.add(key);
    for (const dependency of services.get(key)!.dependencies)
      visit(dependency, [...path, key]);
    order.push(key);
  };
  for (const key of services.keys()) visit(key, []);

  // Keys no file provides: the container must have them, typed as the factory expects.
  const requires = new Map<string, string>();
  for (const key of order)
    services.get(key)!.dependencies.forEach((dependency, index) => {
      if (!services.has(dependency) && !requires.has(dependency))
        requires.set(dependency, `Parameters<typeof ${key}.default>[${index}]`);
    });

  const source = [
    `// Generated from ${relative(dirname(fileURLToPath(output)), fileURLToPath(directory))}/ by generate-wiring.ts. Don't edit: run the generator.`,
    `import type { ServiceRegistry } from 'injecute';`,
    ...order.map(
      (key) => `import * as ${key} from '${services.get(key)!.path}';`,
    ),
    ``,
    `export interface Requires {`,
    ...[...requires].map(([key, type]) => `  ${key}: ${type};`),
    `}`,
    ``,
    `export const addServices = (registry: ServiceRegistry<Requires>) =>`,
    `  registry`,
    ...order.map((key) => {
      const dependencies = services.get(key)!.dependencies;
      const list = dependencies.map((d) => `'${d}'`).join(', ');
      return `    .addSingleton('${key}', ${key}.default${list ? `, [${list}]` : ''})`;
    }),
  ];
  return `${source.join('\n')};\n`;
}
// #endregion generate-wiring

// node examples/custom-registration/codegen/generate-wiring.ts
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const output = new URL('./services.generated.ts', import.meta.url);
  const source = await generateWiring(
    new URL('../services/', import.meta.url),
    output,
  );
  await writeFile(output, source);
}
