// `AsyncLocalStorage` for the runner worker, where `node:async_hooks` doesn't exist. The current
// stores travel with `then()` callbacks and timers. Native `await` doesn't call `then()`, so the editor
// emits ES2016, where TypeScript compiles `async`/`await` to generators driven by `then()`.
// Top-level `await` stays native; it runs outside any context.
type Frame = ReadonlyMap<AsyncLocalStorage<unknown>, unknown>;

let frame: Frame = new Map();

function enter<R>(next: Frame, callback: () => R): R {
  const previous = frame;
  frame = next;
  try {
    return callback();
  } finally {
    frame = previous;
  }
}

/** Binds a callback to the stores current when it was scheduled. */
function bind<F>(callback: F): F {
  if (typeof callback !== 'function') return callback;
  const captured = frame;
  return function (this: unknown, ...args: unknown[]) {
    return enter(captured, () => callback.apply(this, args));
  } as F;
}

export class AsyncLocalStorage<T> {
  getStore(): T | undefined {
    return frame.get(this) as T | undefined;
  }

  run<R>(store: T, callback: (...args: any[]) => R, ...args: any[]): R {
    return enter(new Map(frame).set(this, store), () => callback(...args));
  }

  exit<R>(callback: (...args: any[]) => R, ...args: any[]): R {
    const next = new Map(frame);
    next.delete(this);
    return enter(next, () => callback(...args));
  }
}

/** Patches `then()` (which `catch()`, `finally()` and `Promise.all()` call) and the timers. */
export function installAsyncContext(scope: typeof globalThis) {
  const then = Promise.prototype.then;
  Promise.prototype.then = function (
    this: Promise<unknown>,
    onFulfilled?: unknown,
    onRejected?: unknown,
  ) {
    return then.call(
      this,
      bind(onFulfilled as never),
      bind(onRejected as never),
    );
  } as typeof then;
  const { setTimeout, setInterval, queueMicrotask } = scope;
  scope.setTimeout = ((callback: TimerHandler, ...rest: any[]) =>
    setTimeout(bind(callback), ...rest)) as typeof setTimeout;
  scope.setInterval = ((callback: TimerHandler, ...rest: any[]) =>
    setInterval(bind(callback), ...rest)) as typeof setInterval;
  scope.queueMicrotask = (callback) => queueMicrotask(bind(callback));
}
