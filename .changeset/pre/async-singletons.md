---
'injecute': minor
---

**Async singletons are retried, wrapped and disposed.** When a singleton factory returns a promise, the container caches the promise as before, but:

- a rejected promise is no longer cached forever: the next `get()` calls the factory again;
- the rejection is wrapped in `INJECUTE_RESOLUTION_FAILED` with the resolution `path` (the original error is `cause`), like errors thrown synchronously. Check `error.cause` if you caught your own error types from an awaited `get()`;
- `dispose()` releases the **resolved** instance, not the promise, so `addSingleton('db', async () => new Pool())` closes the pool. A singleton still being created is awaited first; one whose promise rejected is skipped. `dispose` functions in the options receive the resolved value, and their parameter is typed that way (also for `addInstance` promises registered with `dispose`).
