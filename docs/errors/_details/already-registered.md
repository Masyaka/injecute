## Example

```ts
app.addInstance('logger', console).addInstance('logger', pino()); // throws

app.addInstance('logger', pino(), { replace: true }); // replaces it
app.fork().addInstance('logger', pino()); // a fork can override without replace
```

To wrap the existing service instead of replacing it, depend on its own key (see
[Decorating a service](../guide/registration.md#decorating-a-service)).
