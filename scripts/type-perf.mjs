// Type-checking cost of a long registration chain (the worst case for the fluent API).
//   node scripts/type-perf.mjs            -> chain of 300, reports instantiations and check time
//   TYPE_PERF_LENGTH=150 TYPE_PERF_BUDGET=2000000 node scripts/type-perf.mjs
// Exits 1 when the instantiation count exceeds TYPE_PERF_BUDGET (if set).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const length = Number(process.env.TYPE_PERF_LENGTH ?? 300);
const budget = process.env.TYPE_PERF_BUDGET
  ? Number(process.env.TYPE_PERF_BUDGET)
  : undefined;

let source = `import { DIContainer } from '${join(root, 'src/index.ts')}';\nexport const c = new DIContainer()\n  .addInstance('s0', 0)\n`;
for (let i = 1; i < length; i++) {
  source += `  .addSingleton('s${i}', (a, b) => a + b, ['s${Math.floor(i / 2)}', 's${i - 1}'])\n`;
}
source += `;\nexport const last: number = c.get('s${length - 1}');\n`;

const dir = mkdtempSync(
  join(process.env.RUNNER_TEMP ?? tmpdir(), 'injecute-type-perf-'),
);
const file = join(dir, 'chain.ts');
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
  const errors = output.split('\n').filter((line) => line.includes('error TS'));
  console.error(
    `the generated chain does not typecheck:\n${errors.slice(0, 5).join('\n')}`,
  );
  process.exit(1);
}
const read = (label) => output.match(new RegExp(`${label}:\\s+([\\d.]+)`))?.[1];
const instantiations = Number(read('Instantiations'));
console.log(
  `chain of ${length}: ${instantiations.toLocaleString('en')} instantiations, check time ${read('Check time')}s`,
);
if (budget !== undefined && instantiations > budget) {
  console.error(`over budget: ${instantiations} > ${budget}`);
  process.exit(1);
}
