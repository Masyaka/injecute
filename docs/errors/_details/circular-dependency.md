## Example

```ts
app
  .addSingleton('a', (b) => new A(b), ['b'])
  .addSingleton('b', (a) => new B(a), ['a']); // throws: a -> *b* -> a
```

## Breaking the cycle

- Move what both services need into a third service that neither depends on the other.
- Resolve one side lazily with a function dependency, so it is only resolved when used:

```ts
app.addSingleton('b', (getA) => new B(getA), [() => () => app.get('a')]);
```
