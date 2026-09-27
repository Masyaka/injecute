// Adds declarations for Symbol.dispose / Symbol.asyncDispose to the npm type declarations.
//
// The sources are compiled with the ESNext.Disposable lib, so the emitted .d.ts files reference
// `typeof Symbol.asyncDispose`. Projects whose `lib` lacks those symbols (e.g. "ES2022") would then
// get errors inside our declarations when `skipLibCheck` is false. JSR rejects `declare global` in
// published sources, so the augmentation is added to the npm build only.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const lib = 'lib';
const globalFile = 'global-disposable.d.ts';

writeFileSync(
  join(lib, globalFile),
  `// Added by scripts/postbuild.mjs. Declares the well-known disposal symbols for projects whose
// \`lib\` setting predates them; identical to the declarations in TypeScript's ESNext.Disposable lib.
declare global {
  interface SymbolConstructor {
    readonly dispose: unique symbol;
    readonly asyncDispose: unique symbol;
  }
}
export {};
`,
);

const files = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(join(dir, entry.name))
      : [join(dir, entry.name)],
  );

let patched = 0;
for (const file of files(lib)) {
  if (!file.endsWith('.d.ts') || file.endsWith(globalFile)) continue;
  const source = readFileSync(file, 'utf8');
  if (!/Symbol\.(asyncDispose|dispose)/.test(source)) continue;
  const depth = file.split('/').length - 2;
  const reference = `/// <reference path="${depth === 0 ? './' : '../'.repeat(depth)}${globalFile}" />\n`;
  writeFileSync(file, reference + source);
  patched++;
}
console.log(
  `postbuild: disposal symbol declarations referenced from ${patched} file(s)`,
);
