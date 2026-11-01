// Checks that bundlers pick the right hints for error messages (see "Hints in browser bundles" on the
// Errors page): browser production builds leave them out, browser development builds and server
// builds keep them, and `import 'injecute/hints'` adds them back. Builds a small app against the
// built package with Vite, runs each bundle and reads the error message it prints.
// Run after a build (`npm run build`).
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'vite';

const root = mkdtempSync(join(tmpdir(), 'injecute-hints-'));
mkdirSync(join(root, 'node_modules'));
symlinkSync(resolve('.'), join(root, 'node_modules', 'injecute'), 'dir');

const app = (imports) => `${imports}
import { DIContainer } from 'injecute';
try {
  new DIContainer().get('missing');
} catch (error) {
  console.log(error.message.includes('\\n  Hint: ') ? 'hint' : 'no hint');
}
`;
writeFileSync(join(root, 'plain.js'), app(''));
writeFileSync(join(root, 'opt-in.js'), app("import 'injecute/hints';"));

const cases = [
  {
    name: 'browser, production',
    entry: 'plain.js',
    mode: 'production',
    expected: 'no hint',
  },
  {
    name: 'browser, development',
    entry: 'plain.js',
    mode: 'development',
    expected: 'hint',
  },
  {
    name: 'browser, production, injecute/hints',
    entry: 'opt-in.js',
    mode: 'production',
    expected: 'hint',
  },
  {
    name: 'server (SSR), production',
    entry: 'plain.js',
    mode: 'production',
    ssr: true,
    expected: 'hint',
  },
];

const problems = [];
try {
  for (const { name, entry, mode, ssr, expected } of cases) {
    process.env.NODE_ENV = mode;
    const outDir = join(root, 'dist', name.replace(/\W+/g, '-'));
    await build({
      root,
      mode,
      configFile: false,
      logLevel: 'silent',
      ssr: ssr ? { noExternal: true } : undefined,
      build: {
        outDir,
        minify: mode === 'production',
        ssr: ssr ? entry : undefined,
        lib: ssr
          ? undefined
          : { entry, formats: ['es'], fileName: () => 'app.js' },
        rollupOptions: ssr
          ? { output: { entryFileNames: 'app.js' } }
          : undefined,
      },
    });
    const printed = execFileSync('node', [join(outDir, 'app.js')], {
      encoding: 'utf8',
    }).trim();
    const ok = printed === expected;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${printed}`);
    if (!ok) problems.push(`${name}: expected "${expected}", got "${printed}"`);
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
