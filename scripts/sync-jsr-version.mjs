// Keeps jsr.json's version equal to package.json's version.
// Changesets only bumps package.json, so the release flow runs this after `changeset version`.
//   node scripts/sync-jsr-version.mjs          -> writes jsr.json
//   node scripts/sync-jsr-version.mjs --check  -> exits 1 when the versions differ
import { readFileSync, writeFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const jsr = JSON.parse(readFileSync('jsr.json', 'utf8'));

if (process.argv.includes('--check')) {
  if (pkg.version !== jsr.version) {
    console.error(
      `jsr.json version ${jsr.version} does not match package.json version ${pkg.version}. Run: node scripts/sync-jsr-version.mjs`,
    );
    process.exit(1);
  }
} else if (pkg.version !== jsr.version) {
  jsr.version = pkg.version;
  writeFileSync('jsr.json', JSON.stringify(jsr, null, 2) + '\n');
  console.log(`jsr.json version set to ${pkg.version}`);
}
