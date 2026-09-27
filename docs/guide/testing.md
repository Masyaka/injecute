---
title: Testing
description: Replace dependencies in tests with isolated forks, clean up with await using, and assert error codes.
---

# Testing

## Replace a dependency everywhere: isolated forks

An isolated fork builds every service it resolves itself. Replace the dependency in the fork and
everything resolved through it uses the replacement; the app container is untouched.

<<< @/../examples/testing.ts#isolated-fork

`await using` disposes whatever the test created, even when an assertion throws.

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
