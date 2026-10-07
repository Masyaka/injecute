---
title: Startup and shutdown
description: Lifecycle hooks with createLifecycle() and startLifecycle(): modules plug into each other at startup (routes, subscriptions, jobs), start work in stages, and stop gracefully in reverse.
---

# Startup and shutdown

Modules often need to run code when the app starts, without the composition root knowing each of them:
start a queue consumer, listen for requests, subscribe to another module's events, mark the app as
ready. And when it stops, undo all of that in reverse before the connections close.

A **lifecycle hook** does that. It is a singleton registered under a **stage key**; `startLifecycle()`
runs the hooks stage by stage and returns a handle that stops them.

## A service that starts and stops

Most hooks start one service and stop it. Register the service with `startable()`: it registers the
service and its hook in one call. This is the default.

```ts
const addPayments = (c: ServiceRegistry<{ bus: EventBus }>) =>
  c.extend(
    startable('consumer', PaymentConsumer, ['bus'], {
      start: (consumer) => consumer.start(),
      stop: (consumer) => consumer.stop(),
    }),
  );
```

It registers `consumer` and the hook `consumer:start` (in a namespace, `Payments.consumer:start`).
`start` may return a promise; pass `stage: lifecycle.init` to start in another stage. The services it
needs come from the factory's parameter types (annotate them on a function factory), and `extend()`
checks that the container has them.

## Writing a hook

For anything else (subscribing to events, marking the app ready, running migrations), or in an
`AsyncDIContainer`, write the hook yourself. `lifecycle.start('server')` is the key `'server:start'`.
Register the hook under it with `addSingleton`: the factory is the hook, its dependencies are what it
needs, and it may return a function that **undoes** it.

<<< @/../examples/startup-shutdown.ts#platform

[Open in the playground](../playground?example=startup-shutdown)

Hooks are ordinary registrations: their dependencies are typed, they show up in the services graph, and
an error names the hook (`Failed to create "server:start": …`). In a namespace the key is prefixed like
any other. Each stage is a [tag](./tags.md) of lifecycle hooks, and the hooks of a stage are the
services under it.

## Stages

`startLifecycle()` runs the stages in order. Each stage runs its hooks one by one, in registration order.

| Stage   | What runs                                                                      | Undone |
| ------- | ------------------------------------------------------------------------------ | ------ |
| `init`  | wire runtime registries (subscribe to events, register jobs), migrate, warm up | last   |
| `start` | begin accepting work: listen, start consumers, schedulers, pollers             | second |
| `ready` | announce: readiness probe on, register in service discovery, log "started"     | first  |

Stopping undoes them in reverse: readiness off first (no new traffic), then the server closes and the
consumers stop, then the subscriptions are removed. Then the container is disposed and releases the
connections.

## Contributing to another module

By default, a module that accepts contributions (routes, commands, health checks) declares an
[extension point with a tag](./tags.md), and collects them with `collect(tag)`. No hook is needed.

Use an `init` hook only for a registry that changes at runtime, where adding has an undo (an event
bus's `on()` returns the unsubscribe). Hooks of `init` finish before `start` begins accepting work:

<<< @/../examples/startup-shutdown.ts#contribute

The owner doesn't know its contributors, and contributors don't know about each other.

## Starting and stopping the app

<<< @/../examples/startup-shutdown.ts#start-stop

In a Node.js server, stop on `SIGTERM` (a complete entry point is in
[Graceful shutdown in Node.js](#graceful-shutdown-in-node-js)):

```ts
const running = await startLifecycle(app);
process.once('SIGTERM', () =>
  running.stop().catch((error) => console.error(error)),
);
```

`running.hooks` lists the hooks that ran, in order: log it at startup to see what your modules
contributed. `running.state` is `started`, `stopping` or `stopped`.

### Why `stop()` and not just `dispose()`

`dispose()` releases instances in reverse **creation** order. Services created while serving requests
are created after the server, so `dispose()` alone would release them while the server still accepts
requests. `stop()` first runs the undo functions (the server closes and drains), then disposes.

### Disposing the container

`running.stop()` disposes the container after the undo functions, and so does a failed start:

- **The order is guaranteed.** Undo first, release second, in one call.
- **A failed start leaves no handle to stop.** Without disposal, the connections opened in `init` stay
  open, and keep Node.js from exiting.
- **A stopped app shouldn't be reused.** Its consumers are stopped and its server is closed; disposing
  turns accidental use into a clear `INJECUTE_DISPOSED`.
- **Tests clean up with one line**: `await using running = await startLifecycle(test)`.

Pass `dispose: false` when something else owns the container (a host framework, a shared test fixture),
or when you need the services after stopping:

```ts
const running = await startLifecycle(app, { dispose: false });
// ...
await running.stop(); // undo ready → start → init; the services are still alive
await flushMetrics(app.get('metrics'));
await app.dispose();
```

A lifecycle runs once per container: the hooks are cached singletons. Calling `startLifecycle()` again
returns the first call's promise (its options are ignored), also when that start failed, and after
`stop()` it rejects with `INJECUTE_LIFECYCLE_STOPPED`. To start again, create a new container or an isolated fork.

## When a hook fails

The hooks that ran are undone in reverse, the container is disposed (unless `dispose: false`), and
`startLifecycle()` rejects with the hook's error: `INJECUTE_RESOLUTION_FAILED`, with the hook's key in
`path` and the original error in `cause`.

<<< @/../examples/startup-shutdown.ts#failure

Invalid hooks and options are different: `startLifecycle()` checks them first and rejects before any
hook runs, leaving the container as it is (see [Rules](#rules)).

Other failures during the same start (an undo function that fails during the rollback, `dispose()`)
don't replace the first one. Pass `onError` to log them:

```ts
const running = await startLifecycle(app, {
  onError: (error, { key, during }) => logger.warn({ error, key, during }),
});
```

## Logging and timing hooks

`onHook` is called after each hook runs and after each undo function, with the time it took:

```ts
const running = await startLifecycle(app, {
  onHook: ({ key, action, ms, error }) =>
    logger.info({
      key,
      action,
      ms: Math.round(ms),
      failed: error !== undefined,
    }),
});
```

Use it for startup logs, metrics, and to find the hook that makes the start slow.

## Concurrent stages

By default hooks run one by one, so the order and the logs are the same on every start. Hooks of a stage
that don't depend on each other's effects can run at once:

```ts
await startLifecycle(app, { concurrent: ['init'] }); // or `true` for every stage
```

A concurrent stage waits for all its hooks, also when one fails, so every undo function is known before
the rollback. Its undo functions also run concurrently; stages are still undone in reverse order.

## Timeouts and cancellation

Pass an `AbortSignal` to bound the start or the stop:

- **Start.** When the signal aborts, `startLifecycle()` stops waiting for the pending hooks and rolls
  back: the undo functions of what ran receive the aborted signal (their cue to be quick) and are waited
  for, then the container is disposed, and the promise rejects with an error that names the hook. A hook
  that finishes later is undone when it does; while it runs, `dispose()` (which waits for it) continues
  in the background.
- **Stop.** Each undo function receives the signal. Once it aborts, the runner stops waiting: each
  remaining step (the undo functions, called with the aborted signal as their cue to take the fast path,
  then `dispose()`) gets one turn of the event loop. `stop()` rejects with `INJECUTE_DISPOSE_FAILED`,
  which lists what failed or didn't finish in time; those steps keep running in the background.

An undo function that drains, then forces when the signal aborts:

```ts
c.addSingleton(
  lifecycle.start('server'),
  (server) => {
    server.listen(8080);
    return (signal: AbortSignal) =>
      new Promise<void>((resolve) => {
        const force = () => server.closeAllConnections();
        if (signal.aborted)
          force(); // already aborted: e.g. a second SIGTERM, or a timed-out start
        else signal.addEventListener('abort', force, { once: true });
        server.close(() => resolve());
      });
  },
  ['server'],
);
```

`dispose()` itself takes no signal, and it waits for singletons that are still being created. A
disposer or a hook that never settles keeps it from finishing; with a signal, `startLifecycle()` and
`stop()` still return in time.

## Graceful shutdown in Node.js

A complete entry point: bound the start, log every hook, stop on `SIGTERM` or `SIGINT` within the grace
period, and stop at once on a second signal.

```ts
// main.ts
import { startLifecycle } from 'injecute';
import { app } from './app.ts';

let running;
try {
  running = await startLifecycle(app, {
    signal: AbortSignal.timeout(60_000), // a broker that never answers fails the start
    onHook: ({ key, action, ms, error }) =>
      logger.info({ key, action, ms, error }),
    onError: (error, context) => logger.warn({ error, ...context }),
  });
} catch (error) {
  logger.error(error); // what ran is undone and the container is disposed
  process.exit(1);
}

const now = new AbortController();
let stopping = false;
const shutdown = (signal: string) => {
  if (stopping) return now.abort(); // a second signal: stop now
  stopping = true;
  logger.info(`${signal}: stopping`);
  // Kubernetes sends SIGKILL 30 s after SIGTERM: leave time for the last log lines.
  running
    .stop({
      signal: AbortSignal.any([now.signal, AbortSignal.timeout(25_000)]),
    })
    .then(
      () => process.exit(0),
      (error) => {
        logger.error(error); // INJECUTE_DISPOSE_FAILED lists what failed or didn't finish
        process.exit(1);
      },
    );
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

`process.exit()` after `stop()` ends the process even when a step that didn't finish in time is still
running in the background.

## Tests

Run the lifecycle on an isolated fork. Hooks run inside the fork with its replacements, and the app is
untouched. A lifecycle with only `init` wires the modules without listening:

<<< @/../examples/startup-shutdown.ts#testing

## Your own stages

An app can define its own stages and give that object to its modules:

<<< @/../examples/startup-shutdown.ts#custom-stages

Stage names are typed: `stages.strat('x')` and `concurrent: ['strat']` are compile errors. Reusable
modules (packages) use the default `lifecycle`: their keys are plain strings, so they run in any app
whose stages include `init`, `start` and `ready`.

## Rules

1. **A resource is a service; a side effect is a hook.** A connection pool is an async singleton. Running
   the migrations with it is a hook that depends on it.
2. **Hooks depend on services, never on other hooks.** Order them with stages. `startLifecycle()` rejects
   a hook that depends on a hook, directly or through a service, with `INJECUTE_INVALID_HOOK`.
3. **Return the undo.** A hook that starts something returns the function that stops it.
4. **Register hooks with `addSingleton` under a key made by `lifecycle.<stage>(name)`.** Don't type the
   keys by hand: a typo in the stage silently never runs. A key that ends with `:<stage>` but isn't a
   singleton is rejected with `INJECUTE_INVALID_HOOK`; keys like `'user:repo'` are not affected.
5. **Don't do work in module functions.** A module only registers. Calling `bus.on()` in the module body
   runs once, on the root, and never in a test fork; a hook runs in whichever container runs the
   lifecycle.
6. **Run the lifecycle on the composition root**, and in tests on an isolated fork. Never on a request
   fork.

## Without the helper

The stage keys work with `preload()` too, which is enough for a script:

```ts
const stage = (name: string) => (key: ServiceKey) =>
  typeof key === 'string' && key.endsWith(`:${name}`);

await preload(app, stage('init'));
await preload(app, stage('start'));
```

`preload()` runs a stage's async hooks at once, doesn't call undo functions and doesn't roll back.
