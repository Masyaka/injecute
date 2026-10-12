---
title: Without a build step
description: Use injecute directly in browsers, Deno and Bun, from npm, JSR or a CDN.
---

# Without a build step

injecute is a plain ES module with no dependencies, so it runs without a bundler.

## Browsers

From a CDN that bundles the package into one request:

```html
<script type="module">
  import { DIContainer } from 'https://esm.sh/injecute@1';
  // or: 'https://cdn.jsdelivr.net/npm/injecute@1/+esm'

  const app = new DIContainer().addSingleton('answer', () => 42);
  console.log(app.get('answer'));
</script>
```

With an import map and the published files:

```html
<script type="importmap">
  {
    "imports": {
      "injecute": "https://cdn.jsdelivr.net/npm/injecute@1/lib/index.js"
    }
  }
</script>
<script type="module">
  import { DIContainer } from 'injecute';
</script>
```

From JSR, through esm.sh:

```html
<script type="module">
  import { DIContainer } from 'https://esm.sh/jsr/@masyaka/injecute@1';
</script>
```

Evergreen browsers are supported (the build targets ES2022).

## Deno

```ts
import { DIContainer } from 'jsr:@masyaka/injecute';
// or from npm: import { DIContainer } from 'npm:injecute';
```

## Bun and Node.js

```ts
import { DIContainer } from 'injecute';
```

Node.js ≥ 22 can also `require('injecute')`.
