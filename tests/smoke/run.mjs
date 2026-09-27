// Packs the package, installs the tarball into a temporary project and imports it the way users do.
//   node tests/smoke/run.mjs                    -> Node: ESM import + require(esm)
//   SMOKE_RUNTIMES=node,deno,bun node tests/smoke/run.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const runtimes = (process.env.SMOKE_RUNTIMES ?? 'node')
  .split(',')
  .map((r) => r.trim());
const run = (cmd, args, cwd) =>
  execFileSync(cmd, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'inherit'],
  }).toString();

const work = mkdtempSync(
  join(process.env.RUNNER_TEMP ?? tmpdir(), 'injecute-smoke-'),
);
run('npm', ['pack', '--silent', '--pack-destination', work], root);
const tarball = readdirSync(work).find((f) => f.endsWith('.tgz'));
writeFileSync(
  join(work, 'package.json'),
  JSON.stringify({ name: 'smoke', private: true, type: 'module' }),
);
run(
  'npm',
  ['install', '--silent', '--no-audit', '--no-fund', join(work, tarball)],
  work,
);

const body = `
class Repo { constructor(db) { this.db = db; } }
const root = new DIContainer()
  .addInstance('db', 'postgres://')
  .addSingleton('repo', construct(Repo), ['db']);
const repo = root.get('repo');
if (!(repo instanceof Repo) || repo.db !== 'postgres://') throw new Error('wrong repo');
if (root.fork().get('repo') !== repo) throw new Error('singleton not shared with fork');
const disposed = [];
const scope = new DIContainer().addSingleton('conn', () => ({ close: () => disposed.push('conn') }), {
  dependencies: [],
  dispose: (conn) => conn.close(),
});
scope.get('conn');
if (typeof scope[Symbol.asyncDispose] !== 'function') throw new Error('no Symbol.asyncDispose');
await scope[Symbol.asyncDispose]();
if (disposed.join() !== 'conn') throw new Error('not disposed');
console.log('ok');
`;
writeFileSync(
  join(work, 'esm.mjs'),
  `import { DIContainer, construct } from 'injecute';\n${body}`,
);
writeFileSync(
  join(work, 'cjs.cjs'),
  // CommonJS has no top-level await.
  `const { DIContainer, construct } = require('injecute');\n(async () => {\n${body}\n})().catch((e) => { console.error(e); process.exit(1); });`,
);

const checks = {
  node: [
    ['node', ['esm.mjs']],
    ['node', ['cjs.cjs']],
  ],
  deno: [
    ['deno', ['run', '--quiet', '--allow-read', '--allow-env', 'esm.mjs']],
    [
      'deno',
      [
        'run',
        '--quiet',
        '--allow-read',
        join(root, 'tests/smoke/deno-source.ts'),
      ],
    ],
  ],
  bun: [['bun', ['esm.mjs']]],
};

let failed = false;
for (const runtime of runtimes) {
  for (const [cmd, args] of checks[runtime] ?? []) {
    const label = `${runtime}: ${cmd} ${args.at(-1)}`;
    try {
      const out = run(cmd, args, work).trim();
      if (out !== 'ok') throw new Error(`unexpected output: ${out}`);
      console.log(`✓ ${label}`);
    } catch (error) {
      failed = true;
      console.error(`✗ ${label}\n${error.message}`);
    }
  }
}
process.exit(failed ? 1 : 0);
