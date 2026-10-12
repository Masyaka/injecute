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
`,
);
console.log(`generated ${rows.length} error pages`);
