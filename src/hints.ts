// The hints printed in error messages. Node.js, Deno, Bun and browsers without a bundler load this
// file. Bundlers that build for browsers load lib/hints.browser.js instead (the "browser" field in
// package.json; written by scripts/postbuild.mjs): it resolves to ./hints-full.ts in development
// builds and to ./hints-none.ts otherwise, through the `#injecute-browser-hints` import.
export { hintOf } from './hints-full.ts';
