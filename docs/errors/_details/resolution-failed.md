## Reading it

The message starts with `Failed to create "<key>": <original message>`, and the `Resolving:` line shows
the chain of services that led to it. The original error is `error.cause`:

```ts
try {
  app.get('users');
} catch (error) {
  if (
    error instanceof InjecuteError &&
    error.code === 'INJECUTE_RESOLUTION_FAILED'
  ) {
    console.error(error.path, error.cause);
  }
}
```

Errors that are already `InjecuteError`s (for example a missing dependency deeper in the graph) are not
wrapped again.
