---
'injecute': major
---

**ESM only.** injecute now ships a single ES module build and requires Node.js ≥ 22 (`require('injecute')` keeps working there through `require(esm)`). The package works unchanged in Deno, Bun, browsers and CDNs (esm.sh, jsDelivr), and ships its TypeScript sources so go-to-definition lands on real code. See [Module format: ESM only](https://masyaka.github.io/injecute/migration/0.x-to-1.0#module-format-esm-only).

**Removed the `utils` object.** Import helpers by name instead: `utils.construct(X)` → `construct(X)`. The object broke the published type declarations for projects with `skipLibCheck: false`. See [The utils object is removed](https://masyaka.github.io/injecute/migration/0.x-to-1.0#the-utils-object-is-removed).
