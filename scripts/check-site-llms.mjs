// Checks the website's llms.txt and llms-full.txt (built by vitepress-plugin-llms into
// docs/.vitepress/dist): the llms.txt structure (title, summary, sections), that every link points
// to a Markdown page that exists in the build, and that every guide and concept page is listed.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'docs/.vitepress/dist';
const site = 'https://masyaka.github.io/injecute/';
const llms = readFileSync(join(dist, 'llms.txt'), 'utf8');
const problems = [];

if (!/^# \S/.test(llms))
  problems.push('llms.txt must start with a "# title" line');
if (!/^> \S/m.test(llms)) problems.push('llms.txt has no "> summary" line');
if (!/^## /m.test(llms)) problems.push('llms.txt has no "## section"');

const links = [...llms.matchAll(/\]\((\S+?)\)/g)].map(([, href]) => href);
for (const href of links) {
  if (!href.startsWith(site)) {
    problems.push(`not a link into the site: ${href}`);
    continue;
  }
  const file = join(dist, href.slice(site.length));
  if (!file.endsWith('.md') || !existsSync(file))
    problems.push(`link to a missing Markdown page: ${href}`);
}
for (const section of ['guide', 'concepts', 'migration']) {
  for (const page of readdirSync(join('docs', section)).filter((f) =>
    f.endsWith('.md'),
  ))
    if (!links.includes(`${site}${section}/${page}`))
      problems.push(`llms.txt does not list ${section}/${page}`);
}
const full = readFileSync(join(dist, 'llms-full.txt'), 'utf8');
if (full.includes('<<< @/'))
  problems.push('llms-full.txt contains unresolved snippet embeds');

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(
  `site llms.txt: ${links.length} links OK; llms-full.txt ${(full.length / 1024).toFixed(0)} kB`,
);
