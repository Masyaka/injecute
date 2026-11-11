// Typechecks tests/types-consumer/consumer.ts against the packed package, with skipLibCheck: false,
// using the TypeScript version from TS_VERSION (default: latest). CI runs it on the oldest
// supported version (5.2) and on latest.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const tsVersion = process.env.TS_VERSION ?? 'latest';
const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'inherit'],
  }).toString();

const work = mkdtempSync(
  join(process.env.RUNNER_TEMP ?? tmpdir(), 'injecute-types-'),
);
run('npm', ['pack', '--silent', '--pack-destination', work], root);
const tarball = readdirSync(work).find((f) => f.endsWith('.tgz'));
writeFileSync(
  join(work, 'package.json'),
  JSON.stringify({ name: 'types-consumer', private: true, type: 'module' }),
);
run(
  'npm',
  [
    'install',
    '--silent',
    '--no-audit',
    '--no-fund',
    join(work, tarball),
    `typescript@${tsVersion}`,
  ],
  work,
);
copyFileSync(join(here, 'consumer.ts'), join(work, 'consumer.ts'));
copyFileSync(join(here, 'tsconfig.json'), join(work, 'tsconfig.json'));

const version = run('npx', ['tsc', '--version'], work).trim();
try {
  run('npx', ['tsc', '-p', '.'], work);
  console.log(`✓ consumer typechecks with ${version} (skipLibCheck: false)`);
} catch (error) {
  console.error(
    `✗ consumer fails with ${version}\n${error.stdout?.toString() ?? error.message}`,
  );
  process.exit(1);
}
