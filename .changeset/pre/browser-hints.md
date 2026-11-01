---
'injecute': minor
---

**Smaller browser bundles: error hints are left out of production builds.** Bundlers that build for browsers now leave the "how to fix it" hints out of injecute's error messages, which saves about 1.5 kB gzipped. Development builds with Vite and webpack keep them, through the `development` condition, and so do Node.js, Deno, Bun, server-side rendering and browsers without a bundler. Messages keep what happened and the docs link, and `error.code` and `error.docs` are the same everywhere.

To have the hints in any build, import the new `injecute/hints` entry point, for example `if (import.meta.env.DEV) await import('injecute/hints')`, or `import 'injecute/hints'` for every build. With esbuild or Rolldown, adding the `development` condition works too. See [Hints in browser bundles](https://masyaka.github.io/injecute/errors/#hints-in-browser-bundles).
