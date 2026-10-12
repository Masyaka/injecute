## Where you see it

`running.stop()` runs every undo function, even when some fail, then rejects with
`INJECUTE_DISPOSE_FAILED`. Each failed undo is an `INJECUTE_UNDO_FAILED` in `cause.errors`, with the hook
in `path`:

```ts
try {
  await running.stop({ signal: AbortSignal.timeout(25_000) });
} catch (error) {
  for (const failure of (error as InjecuteError).cause.errors) {
    if (failure.code === 'INJECUTE_UNDO_FAILED') {
      console.error(failure.path[0], failure.cause); // which hook, and why
    }
  }
}
```

After a failed start, the rollback reports them to `onError` with `during: 'rollback'`. An undo that
"did not finish before the signal aborted" keeps running in the background. See
[Startup and shutdown](../guide/startup-shutdown.md#timeouts-and-cancellation).
