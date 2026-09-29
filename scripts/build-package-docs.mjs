// Builds the Markdown docs shipped in the npm package (lib/docs/), so coding agents can read the docs
// of the installed version in node_modules/injecute. The pages are the site's (docs/), with the
// VitePress-only syntax resolved: `<<< @/…#region` embeds are inlined from examples/, Twoslash markers
// are removed, and links to pages that aren't shipped point to the website.
// Then checks that the package's llms.txt links resolve and that it lists every shipped page.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, posix } from 'node:path';

const site = 'https://masyaka.github.io/injecute/';
const docs = 'docs';
const out = 'lib/docs';
const sections = ['guide', 'concepts', 'errors', 'migration'];

if (!existsSync(join(docs, 'errors', 'index.md')))
  throw new Error('docs/errors/*.md are missing: run `npm run docs:errors`');

const pages = sections.flatMap((section) =>
  readdirSync(join(docs, section))
    .filter((file) => file.endsWith('.md'))
    .map((file) => `${section}/${file}`),
);
const shipped = new Set(pages);

rmSync(out, { recursive: true, force: true });
for (const page of pages) {
  const target = join(out, page);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(
    target,
    render(page, readFileSync(join(docs, page), 'utf8')) + '\n',
  );
}
checkLlmsTxt();
console.log(`package docs: ${pages.length} pages in ${out}`);

function render(page, source) {
  const lines = source.replace(/^---\n[\s\S]*?\n---\n/, '').split('\n');
  const result = [];
  let fence; // the open code fence: { marker, twoslash, start }
  let dropped = false; // a line was dropped: skip the blank line after it
  for (const line of lines) {
    if (fence) {
      if (line.trimStart().startsWith(fence.marker)) {
        fence = undefined;
        result.push(line);
      } else if (fence.twoslash && line.includes('// ---cut---')) {
        result.splice(fence.start);
      } else if (
        !fence.twoslash ||
        !/^\s*\/\/\s*(\^[?|!]|@\w+)/.test(line) // `//  ^?` queries and `// @errors:` directives
      ) {
        result.push(line);
      }
      continue;
    }
    const open = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(line);
    if (open) {
      const [, indent, marker, info] = open;
      const twoslash = /\btwoslash\b/.test(info);
      result.push(indent + marker + info.replace(/\s*\btwoslash\b/, ''));
      fence = { marker, twoslash, start: result.length };
      continue;
    }
    const embed =
      /^<<<\s+@\/(\S+?)(?:#([\w-]+))?(?:\{[^}]*\})?(?:\s+\[.*\])?\s*$/.exec(
        line,
      );
    if (embed) {
      result.push(...snippet(page, join(docs, embed[1]), embed[2]));
      continue;
    }
    const include = /^<!--\s*@include:\s*(\S+?)\s*-->$/.exec(line.trim());
    if (include)
      throw new Error(`${page}: @include is not supported in shipped pages`);
    const container = /^:::\s*(\S*)\s*(.*)$/.exec(line);
    if (container) {
      const [, type, title] = container;
      // code groups and closing markers are dropped; tips and warnings keep their title
      if (type && type !== 'code-group')
        result.push(`**${title || type[0].toUpperCase() + type.slice(1)}:**`);
      else dropped = true;
      continue;
    }
    if (dropped && line === '' && result.at(-1) === '') continue;
    dropped = false;
    result.push(rewriteLinks(page, line));
  }
  if (fence) throw new Error(`${page}: unclosed code fence`);
  return result.join('\n').trim();
}

/** The lines of `file` inside `// #region name` (the whole file without region markers otherwise). */
function snippet(page, file, region) {
  if (!existsSync(file)) throw new Error(`${page}: ${file} does not exist`);
  let lines = readFileSync(file, 'utf8').split('\n');
  if (region) {
    const start = lines.findIndex((l) =>
      new RegExp(`^\\s*//\\s*#region\\s+${region}\\s*$`).test(l),
    );
    const end = lines.findIndex(
      (l, i) =>
        i > start &&
        new RegExp(`^\\s*//\\s*#endregion(\\s+${region})?\\s*$`).test(l),
    );
    if (start < 0 || end < 0)
      throw new Error(`${page}: region "${region}" not found in ${file}`);
    lines = lines.slice(start + 1, end);
  }
  lines = lines.filter((l) => !/^\s*\/\/\s*#(end)?region\b/.test(l));
  const indent = Math.min(
    ...lines.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)[0].length),
  );
  const language = posix.extname(file).slice(1);
  return ['```' + language, ...lines.map((l) => l.slice(indent)), '```'].filter(
    (l, i, all) => !(l === '' && (i === 1 || i === all.length - 2)),
  );
}

function rewriteLinks(page, line) {
  return line.replace(/\]\(([^)\s]+)\)/g, (match, href) => {
    if (/^([a-z]+:|#)/i.test(href)) return match;
    const [, path, query = '', hash = ''] = /^([^?#]*)(\?[^#]*)?(#.*)?$/.exec(
      href,
    );
    const resolved = path.startsWith('/')
      ? path.slice(1)
      : posix.normalize(posix.join(posix.dirname(page), path));
    if (resolved.startsWith('..'))
      throw new Error(`${page}: link outside the docs: ${href}`);
    const asPage =
      resolved === '' || resolved.endsWith('/')
        ? `${resolved}index.md`
        : posix.extname(resolved)
          ? resolved
          : `${resolved}.md`;
    if (shipped.has(asPage)) {
      const relative = posix.relative(posix.dirname(page), asPage);
      return `](${relative.startsWith('.') ? relative : `./${relative}`}${hash})`;
    }
    const route = asPage.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '');
    if (
      asPage.endsWith('.md') &&
      !existsSync(join(docs, asPage)) &&
      !route.startsWith('api/')
    )
      throw new Error(`${page}: broken link ${href}`);
    return `](${site}${route}${query}${hash})`;
  });
}

function checkLlmsTxt() {
  const llms = readFileSync('llms.txt', 'utf8');
  const links = [...llms.matchAll(/\]\((\.\/[^)\s#]+)[^)]*\)/g)].map(
    ([, href]) => posix.normalize(href),
  );
  const missing = links.filter((href) => !existsSync(href));
  if (missing.length)
    throw new Error(`llms.txt links to missing files: ${missing.join(', ')}`);
  // error code pages are listed on errors/index.md
  const unlisted = pages
    .filter((page) => !page.startsWith('errors/') || page === 'errors/index.md')
    .filter((page) => !links.includes(posix.join(out, page)));
  if (unlisted.length)
    throw new Error(`llms.txt does not list: ${unlisted.join(', ')}`);
}
