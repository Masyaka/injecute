## Example

```ts
const app = new DIContainer().addSingleton('db', createDb);

app.fork({ isolated: true }).addInstance('dbb', fakeDb, { replace: true }); // throws: a typo
app.fork({ isolated: true }).addInstance('db', fakeDb, { replace: true }); // replaces "db"
```

## Why it throws

`replace: true` says that something is registered under the key. When nothing is, the replacement
would quietly become a new service that nothing uses, and the original you meant to replace would
still be in place. Common causes:

- a typo in the key;
- a module that should register the original wasn't applied, or is applied after the replacement:
  apply modules first, then replace;
- a test override for a service the app no longer has.

If this is the first registration of the key, remove `replace: true`.
