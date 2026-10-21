## Example

```ts
app.addInstance('logger', console).addInstance('logger', pino()); // throws

app.addInstance('logger', pino(), { replace: true }); // replaces it
app.fork().addInstance('logger', pino()); // throws: the parent has "logger"
app.fork().addInstance('logger', pino(), { replace: true }); // overrides it in the fork
```

## Overriding a parent's key in a fork

A fork needs `{ replace: true }` to register a key its parent has, because the override doesn't reach
everything. In a plain fork it reaches only the services resolved in the fork: a service registered in
the parent runs and is cached in the parent, so it keeps the parent's instance. The error names those
services:

```ts
const app = new DIContainer()
  .addSingleton('tx', (db) => db.begin(), ['db'])
  .addSingleton('report', Report, ['tx']);

app.fork().addSingleton('tx', (db) => db.begin(), ['db']);
// throws: "report" (registered in a parent) depends on "tx" and keeps the parent's "tx"
```

What to do depends on what you want:

- **Only the fork's own services should use the new one:** pass `{ replace: true }`.
- **A parent service should use it too:** register that service in the fork as well (for per-request
  services, in a [request module](../guide/request-state.md#per-request-registrations-in-modules)), and
  don't register the key in the root.
- **Every service should use it** (tests, a variant of the app): use an
  [isolated fork](../guide/containers.md#isolated-forks), with `{ replace: true }`.

To wrap the existing service instead of replacing it, depend on its own key (see
[Decorating a service](../guide/registration.md#decorating-a-service)).
