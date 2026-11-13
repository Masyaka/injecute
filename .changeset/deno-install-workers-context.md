---
---

Docs: on Deno, install with `deno add npm:injecute` so the `'injecute'` imports in the guides resolve
(`deno add jsr:@masyaka/injecute` maps the import as `@masyaka/injecute`); "Without a build step" shows
how to map `injecute` to JSR instead. The Hono guide's Cloudflare Workers entry point now imports
`storage` from `./context.ts`: with its own `AsyncLocalStorage`, services never saw the request context.
