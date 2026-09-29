---
'injecute': major
---

**`preload()` returns a promise** that settles once async services are created and rejects with the first failure (before, a failing async service became an unhandled rejection). Synchronous failures still throw immediately. `preload(app)` → `await preload(app)`. [Migration](https://masyaka.github.io/injecute/migration/0.x-to-1.0#preload-returns-a-promise)
