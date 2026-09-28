// After a release: imports the published version from the CDNs and JSR, the way no-build users do
// (docs/guide/no-build.md), and runs a small container on each. Run with Deno:
//   INJECUTE_VERSION=1.0.0 deno run --allow-net --allow-env --allow-import tests/smoke/cdn.mjs
// CDNs pick up a new version within minutes, so each source is polled before it is imported.
const version = process.env.INJECUTE_VERSION;
if (!version) throw new Error('Set INJECUTE_VERSION');

const sources = {
  'esm.sh': `https://esm.sh/injecute@${version}`,
  'jsDelivr +esm': `https://cdn.jsdelivr.net/npm/injecute@${version}/+esm`,
  'jsDelivr (raw files)': `https://cdn.jsdelivr.net/npm/injecute@${version}/lib/index.js`,
  'unpkg (raw files)': `https://unpkg.com/injecute@${version}/lib/index.js`,
  'esm.sh (JSR)': `https://esm.sh/jsr/@masyaka/injecute@${version}`,
  JSR: `jsr:@masyaka/injecute@${version}`,
};

const attempts = Number(process.env.CDN_ATTEMPTS ?? 20);
const delayMs = 30_000;

async function available(name, specifier) {
  const url = specifier.startsWith('jsr:')
    ? `https://jsr.io/@masyaka/injecute/${version}_meta.json`
    : specifier;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const response = await fetch(url).catch(() => undefined);
    await response?.body?.cancel();
    if (response?.ok) return;
    if (attempt === attempts) break;
    console.log(
      `${name}: not available yet (${response?.status ?? 'network error'}), retrying`,
    );
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(
    `${name}: ${url} is not available after ${attempts} attempts`,
  );
}

let failed = false;
for (const [name, specifier] of Object.entries(sources)) {
  try {
    await available(name, specifier);
    const { DIContainer, InjecuteError } = await import(specifier);
    class Database {
      constructor(url) {
        this.url = url;
      }
    }
    const app = new DIContainer()
      .addInstance('url', 'postgres://cdn')
      .addSingleton('db', Database, ['url']);
    if (app.get('db').url !== 'postgres://cdn') throw new Error('wrong value');
    try {
      app.get('missing');
      throw new Error('expected an error');
    } catch (error) {
      if (
        !(error instanceof InjecuteError) ||
        error.code !== 'INJECUTE_NOT_REGISTERED'
      )
        throw error;
    }
    console.log(`✓ ${name}: ${specifier}`);
  } catch (error) {
    failed = true;
    console.error(
      `✗ ${name}: ${specifier}\n  ${error instanceof Error ? error.message : error}`,
    );
  }
}
if (failed) process.exit(1);
