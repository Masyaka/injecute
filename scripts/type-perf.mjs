// Type-checking cost of the worst cases for the fluent API:
//   chain:      one long registration chain (TYPE_PERF_LENGTH registrations, default 300)
//   namespaces: 16 namespaces, each with a nested namespace, on top of a 40-registration root
//   boundaries: 150 extend()/namespace() calls on one container (types must not decay to `any`)
//   node scripts/type-perf.mjs             -> reports instantiations and check time of both
//   TYPE_PERF_LENGTH=150 TYPE_PERF_BUDGET=2000000 node scripts/type-perf.mjs
// Exits 1 when a scenario's instantiation count exceeds its budget (TYPE_PERF_BUDGET for the chain,
// TYPE_PERF_NAMESPACE_BUDGET for namespaces, TYPE_PERF_BOUNDARY_BUDGET for boundaries), if set.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const length = Number(process.env.TYPE_PERF_LENGTH ?? 300);
const budgetOf = (name) =>
  process.env[name] ? Number(process.env[name]) : undefined;
const header = `import { DIContainer, type ServiceRegistry } from '${join(root, 'src/index.ts')}';\n`;

function chainSource() {
  let source = `${header}export const c = new DIContainer()\n  .addInstance('s0', 0)\n`;
  for (let i = 1; i < length; i++) {
    source += `  .addSingleton('s${i}', (a, b) => a + b, ['s${Math.floor(i / 2)}', 's${i - 1}'])\n`;
  }
  return `${source};\nexport const last: number = c.get('s${length - 1}');\n`;
}

// Every namespace callback receives the whole parent service map, so the cost of each namespace()
// call grows with the container; this catches types that make it grow faster than the map.
function namespacesSource() {
  const registrations = (prefix, indent) =>
    [0, 1, 2, 3]
      .map(
        (i) =>
          `${indent}.addSingleton('${prefix}${i}', (r) => r + ${i}, ['r${i}'])`,
      )
      .join('\n');
  let source = `${header}export const c = new DIContainer()\n  .addInstance('r0', 0)\n`;
  for (let i = 1; i < 40; i++) {
    source += `  .addSingleton('r${i}', (a) => a + 1, ['r${i - 1}'])\n`;
  }
  for (let n = 0; n < 16; n++) {
    source += `  .namespace('N${n}', (ns) =>\n    ns\n${registrations('s', '      ')}\n`;
    source += `      .namespace('Inner', (inner) =>\n        inner\n${registrations('t', '          ')},\n      ),\n  )\n`;
  }
  return `${source};\nexport const last: number = c.get('N15.Inner.t3');\n`;
}

// Many extend()/namespace() calls on one container: guards against service map types that nest with
// every call (they hit TypeScript's depth limit and silently turn the container into `any`).
function boundariesSource() {
  let source = `${header}const add = <const K extends string>(k: K) =>\n  (c: ServiceRegistry<{ s0: number }>) => c.addSingleton(k, (a) => a + 1, ['s0']);\nexport const c = new DIContainer()\n  .addInstance('s0', 0)\n`;
  for (let i = 0; i < 150; i++) {
    source +=
      i % 2
        ? `  .extend(add('e${i}'))\n`
        : `  .namespace('N${i}', (ns) => ns.addSingleton('x', (a) => a * 2, ['s0']))\n`;
  }
  // the earliest services must keep their types, and typos must still be errors
  return `${source};\nexport const first: number = c.get('N0.x');\nexport const last: number = c.get('e149');\n// @ts-expect-error unknown key\nc.get('e0x');\n`;
}

const dir = mkdtempSync(
  join(process.env.RUNNER_TEMP ?? tmpdir(), 'injecute-type-perf-'),
);

function measure(name, source, budget) {
  const file = join(dir, `${name}.ts`);
  writeFileSync(file, source);
  let output;
  try {
    output = execFileSync(
      process.execPath,
      [
        '--stack-size=8000',
        join(root, 'node_modules/typescript/lib/tsc.js'),
        '--noEmit',
        '--strict',
        '--skipLibCheck',
        '--allowImportingTsExtensions',
        '--target',
        'es2022',
        '--lib',
        'es2022,esnext.disposable',
        '--module',
        'nodenext',
        '--moduleResolution',
        'nodenext',
        '--extendedDiagnostics',
        file,
      ],
      { encoding: 'utf8', cwd: dir },
    );
  } catch (error) {
    output = String(error.stdout ?? '');
    const errors = output
      .split('\n')
      .filter((line) => line.includes('error TS'));
    console.error(
      `the generated ${name} does not typecheck:\n${errors.slice(0, 5).join('\n')}`,
    );
    return false;
  }
  const read = (label) =>
    output.match(new RegExp(`${label}:\\s+([\\d.]+)`))?.[1];
  const instantiations = Number(read('Instantiations'));
  console.log(
    `${name}: ${instantiations.toLocaleString('en')} instantiations, check time ${read('Check time')}s`,
  );
  if (budget !== undefined && instantiations > budget) {
    console.error(`${name} over budget: ${instantiations} > ${budget}`);
    return false;
  }
  return true;
}

const results = [
  measure(`chain of ${length}`, chainSource(), budgetOf('TYPE_PERF_BUDGET')),
  measure(
    'namespaces',
    namespacesSource(),
    budgetOf('TYPE_PERF_NAMESPACE_BUDGET'),
  ),
  measure(
    'boundaries',
    boundariesSource(),
    budgetOf('TYPE_PERF_BOUNDARY_BUDGET'),
  ),
];
if (results.includes(false)) process.exit(1);
