// Generates docs/errors/<slug>.md and docs/errors/index.md from the error-code registry
// (lib/errors.js, built from src/errors.ts), so the pages always match what the library throws.
// Optional hand-written sections live in docs/errors/_details/<slug>.md and are appended.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { errorCodes, errorDocsUrl } from '../lib/errors.js';

const dir = 'docs/errors';
mkdirSync(dir, { recursive: true });
for (const file of readdirSync(dir))
  if (file.endsWith('.md')) rmSync(join(dir, file));

const slugOf = (code) => errorDocsUrl(code).split('/').pop();
const rows = [];
for (const [code, { title, hint }] of Object.entries(errorCodes)) {
  const slug = slugOf(code);
  const detailsFile = join(dir, '_details', `${slug}.md`);
  const details = existsSync(detailsFile)
    ? '\n' + readFileSync(detailsFile, 'utf8').trim() + '\n'
    : '';
  writeFileSync(
    join(dir, `${slug}.md`),
    `---
title: ${code}
description: ${title}
---

# \`${code}\`

**${title}.**

## How to fix it

${hint}
${details}
## Handling it in code

\`\`\`ts
import { InjecuteError } from 'injecute';

try {
  // ...
} catch (error) {
  if (error instanceof InjecuteError && error.code === '${code}') {
    // error.message explains what happened; error.path is the resolution chain
  }
}
\`\`\`

[All error codes](./index.md)
`,
  );
  rows.push(`| [\`${code}\`](./${slug}.md) | ${title} |`);
}

writeFileSync(
  join(dir, 'index.md'),
  `---
title: Errors
description: Every error injecute throws, with how to fix it.
---

# Errors

Every error injecute throws is an \`InjecuteError\` with a stable \`code\`, the resolution \`path\`
(which service needed what), a \`docs\` link to the page below, and a message with a hint.
Branch on \`code\`, not on message text.

| Code | Meaning |
| --- | --- |
${rows.join('\n')}

## Hints in browser bundles

Bundlers that build for browsers leave the hints out of error messages, to keep the bundle small (about
1.5 kB gzipped). Messages keep what happened and the docs link; \`error.code\` and \`error.docs\` are the
same everywhere.

| Where it runs | Hints in messages |
| --- | --- |
| Node.js, Deno, Bun, server-side rendering, browsers without a bundler | always |
| Vite and webpack, development (the dev server, \`--mode development\`) | yes |
| Vite and webpack, production builds | no |
| esbuild, Rolldown | no, unless you add the \`development\` condition (\`conditions: ['development']\`) |

To have them in any build, import \`injecute/hints\` where you want them:

\`\`\`ts
// in development only, with any bundler
if (import.meta.env.DEV) await import('injecute/hints');

// or in every build (staging, or debugging a production build)
import 'injecute/hints';
\`\`\`

Without a bundler, and on servers, the import does nothing: those messages have the hints already. An
error thrown before a dynamic \`import()\` finishes has no hint; a static import doesn't have that gap.
`,
);
console.log(`generated ${rows.length} error pages`);
