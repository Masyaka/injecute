## Common causes

- **A typo in the key.** The message suggests similar keys ("Did you mean …?").
- **The service is registered in a fork**, and you resolve it from the parent. Forks see their parents'
  services, not the other way around.
- **Registration order in a module** that is applied later: register the dependency first, or declare it
  in the module's `ServiceRegistry<{ … }>` type so `extend()` checks it.
- **A dependency of another service**: the message's `Resolving:` line shows which service needed it.

If the service is genuinely optional, depend on `optional('key')` or call `get('key', { optional: true })`.
