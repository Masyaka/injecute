// Checks what the npm tarball contains: the build, the sources for declaration maps, and the docs,
// llms.txt and Agent Skills that coding agents read in node_modules. Nothing for contributors
// (AGENTS.md/CLAUDE.md would be loaded as instructions in consumers' agent sessions), no tests.
// Run after a build (`npm run build`, or `attw --pack`, which runs prepack).
import { execFileSync } from 'node:child_process';

const [pack] = JSON.parse(
  execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    encoding: 'utf8',
  }),
);
const files = pack.files.map((file) => file.path);

const required = [
  'package.json',
  'README.md',
  'LICENSE',
  'CHANGELOG.md',
  'llms.txt',
  'lib/index.js',
  'lib/index.d.ts',
  'lib/index.d.ts.map',
  'src/index.ts',
  'lib/docs/guide/getting-started.md',
  'lib/docs/errors/not-registered.md',
  'lib/docs/migration/0.x-to-1.0.md',
  'skills/injecute/SKILL.md',
  'skills/injecute-migrate-to-v1/SKILL.md',
];
const forbidden = [
  /(^|\/)(AGENTS|CLAUDE)\.md$/,
  /^(tests|examples|docs|scripts|handoffs|\.claude-plugin|\.changeset|\.github)\//,
  /\.test(-d)?\.ts$/,
];

const missing = required.filter((file) => !files.includes(file));
const unexpected = files.filter((file) => forbidden.some((p) => p.test(file)));
const problems = [
  ...missing.map((file) => `missing: ${file}`),
  ...unexpected.map((file) => `must not be published: ${file}`),
];
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(
  `tarball: ${files.length} files, ${(pack.unpackedSize / 1024).toFixed(0)} kB unpacked`,
);
