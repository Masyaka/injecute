import { AsyncLocalStorage } from 'node:async_hooks';
import { DIContainer, preload } from 'injecute';

interface RequestContext {
  traceId: string;
}
const storage = new AsyncLocalStorage<RequestContext>();

// #region captured
// ✗ The context is resolved once, by the first request, and kept for every later one
const captured = new DIContainer()
  .addSingleton('context', () => storage.getStore())
  .addSingleton('logger', (context) => ({ traceId: () => context?.traceId }), [
    'context',
  ]);

// ✓ An accessor is registered, and the context is read when it is used
const accessor = new DIContainer()
  .addInstance('context', { current: () => storage.getStore() })
  .addSingleton(
    'logger',
    (context) => ({ traceId: () => context.current()?.traceId }),
    ['context'],
  );

const requests = ['a', 'b'];
export const fromCaptured = requests.map((traceId) =>
  storage.run({ traceId }, () => captured.get('logger').traceId()),
); // ["a", "a"]
export const fromAccessor = requests.map((traceId) =>
  storage.run({ traceId }, () => accessor.get('logger').traceId()),
); // ["a", "b"]
// #endregion captured

// #region startup
class Pool {
  readonly checks: (string | undefined)[] = [];
  // a timer (like a socket or an event listener) runs in the context it was created in
  readonly #timer = setInterval(
    () => this.checks.push(storage.getStore()?.traceId),
    5,
  ).unref();

  [Symbol.dispose](): void {
    clearInterval(this.#timer);
  }
}

// ✗ Created by the first request that needs it: its timer runs in that request's context forever
const lazy = new DIContainer().addSingleton('pool', Pool);
storage.run({ traceId: 'a' }, () => lazy.get('pool'));
// lazy.get('pool').checks: ["a", "a", …]

// ✓ Created at startup, outside any request
const eager = new DIContainer().addSingleton('pool', Pool);
await preload(eager);
storage.run({ traceId: 'a' }, () => eager.get('pool'));
// eager.get('pool').checks: [undefined, undefined, …]
// #endregion startup

export { lazy, eager };
