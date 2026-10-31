## Example

```ts
const app = new DIContainer()
  .addSingleton('db', () => connect(process.env.DATABASE_URL))
  .addSingleton('users', UserRepository, ['db'])
  .addSingleton('notifications', Notifications, ['mailer']); // nothing registers "mailer"

await checkWiring(app, { resolve: true });
// WiringError: The wiring check found 2 problems:
//   - "mailer" is not registered. Needed by "notifications".
//   - "db" failed: DATABASE_URL is not set. Not resolved because of it: "users".
```

## Reading it

- **Not registered:** a dependency key, or a key passed in `keys`, that no container registers. Check
  the key for typos, and that the module that registers it is applied. The services listed need it,
  directly or through other services.
- **Failed:** resolving the service threw. The services listed depend on it and were skipped, so each
  failure is reported once. The original error is in the problem's `error`, and every failure is in
  `cause` (an `AggregateError`).

`error.problems` has the same list as data, for example to assert on it:

```ts
expect(error.problems).toEqual([
  { type: 'missing', key: 'mailer', affected: ['notifications'] },
  expect.objectContaining({ type: 'failed', key: 'db', affected: ['users'] }),
]);
```

See [Check the wiring](../guide/testing.md#check-the-wiring).
