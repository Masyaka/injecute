---
title: Testing
description: Replace dependencies in tests with isolated forks, clean up with await using, and assert error codes.
---

# Testing

## Replace a dependency everywhere: isolated forks

An isolated fork builds every service it resolves itself. Replace the dependency in the fork and
everything resolved through it uses the replacement; the app container is untouched.

<<< @/../examples/testing.ts#isolated-fork

[Open in the playground](../playground?example=testing)

`await using` disposes whatever the test created, even when an assertion throws.

Forks made from the isolated fork, such as one fork per request, get the replacement too. To replace a
service that a fork per request registers, see
[Testing per-request services](./request-state.md#testing-per-request-services).

## Check the wiring

One test can check that every service is wired: `checkWiring()` reports every dependency key that
nothing registers, and with `resolve: true` every service whose factory throws, all at once, instead of
the first request finding one of them:

<<< @/../examples/testing.ts#check-wiring

- Without `resolve`, nothing runs: it only reads the registrations, so it needs no fakes. With
  `resolve: true` it creates every service once: use an isolated fork with fakes for services that reach
  the outside world (databases, queues, HTTP clients).
- A failing service is reported once, with the services that need it, and its factory runs once:
  services that depend on it are skipped, not reported again.
- It rejects with a `WiringError` (`INJECUTE_WIRING_FAILED`) whose message lists every problem, so a
  failing test shows them all; `error.problems` has them as data.
- Services the compiler can't see, such as ones found in files or registered by decorators, can be
  declared without being registered: pass their keys, see
  [Checking the wiring](./custom-registration.md#checking-the-wiring).
- To create services at startup, use
  [`preload()`](./recipes.md#checking-the-wiring-at-startup) instead: it stops at the first failure,
  which is what an app that is starting needs.

## Override one cached value: `setCacheInstance`

<<< @/../examples/testing.ts#set-cache-instance

This changes the container you pass until the next `reset()`, so prefer isolated forks when tests share
a container.

## Temporary doubles with a middleware

A middleware can answer for some keys and be removed with `unuse()`. See
[Middlewares](./middleware-events.md#test-doubles).

## Asserting errors

Branch on the stable `code`, not on the message:

```ts
import { InjecuteError } from 'injecute';
import { expect, it } from 'vitest';

it('requires a database', () => {
  const app = createApp();
  expect(() => app.get('users')).toThrow(
    expect.objectContaining({ code: 'INJECUTE_NOT_REGISTERED' }),
  );
});
```
