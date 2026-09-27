---
title: Async dependencies
description: Services that are created asynchronously, with defer().
---

# Async dependencies

A factory can return a promise. Services that depend on it then receive the promise. `defer()` wraps a
factory so its promised arguments are awaited first:

<<< @/../examples/async-dependencies.ts#defer

`get()` of a deferred service returns a promise; await it where you use it, or resolve the async
services once at startup:

```ts
const [db, cache] = await Promise.all([app.get('db'), app.get('cache')]);
```

A container that awaits every dependency automatically is being designed for a later release.
