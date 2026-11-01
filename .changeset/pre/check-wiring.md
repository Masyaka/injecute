---
'injecute': minor
---

**`checkWiring()`: check every service's wiring in one test.** `await checkWiring(container)` reports every dependency key that nothing registers, without running any factory. With `{ resolve: true }` it also creates every service and reports the ones whose factory throws. Each failure is reported once, with the services that need it, and its factory runs once. `{ keys }` adds keys that must be registered, for services that the compiler can't see (found in files or registered by decorators). It rejects with a `WiringError` (`INJECUTE_WIRING_FAILED`) that lists every problem in its message and in `error.problems`. See [Check the wiring](https://masyaka.github.io/injecute/guide/testing#check-the-wiring).
