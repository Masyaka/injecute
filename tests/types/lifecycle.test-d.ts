// Type-level tests for the lifecycle utilities. Checked by `npm run typecheck` (tsc), not executed.
import { expectTypeOf } from 'vitest';
import {
  AsyncDIContainer,
  createLifecycle,
  DIContainer,
  lifecycle,
  startLifecycle,
  type Lifecycle,
  type LifecycleHook,
  type LifecycleSignal,
  type RunningLifecycle,
  type ServiceRegistry,
} from '../../src/index.ts';

// ---- stage keys
expectTypeOf(lifecycle.start('server')).toEqualTypeOf<'server:start'>();
expectTypeOf(lifecycle).toEqualTypeOf<Lifecycle<'init' | 'start' | 'ready'>>();
const stages = createLifecycle(['migrate', 'init']);
expectTypeOf(stages).toEqualTypeOf<Lifecycle<'migrate' | 'init'>>();
expectTypeOf(stages.migrate('schema')).toEqualTypeOf<'schema:migrate'>();
// @ts-expect-error: no stage "strat"
lifecycle.strat('server');
// @ts-expect-error: not a stage of `stages`
stages.ready('probe');

// ---- the signal is the global AbortSignal where the environment's types have one
expectTypeOf<LifecycleSignal>().toEqualTypeOf<AbortSignal>();

// ---- hooks in modules: dependencies are typed like any factory
class Consumer {
  start(): void {}
  stop(): Promise<void> {
    return Promise.resolve();
  }
}
const addPayments = (c: ServiceRegistry<{ consumer: Consumer }>) =>
  c.addSingleton(
    lifecycle.start('consumer'),
    (consumer) => {
      expectTypeOf(consumer).toEqualTypeOf<Consumer>();
      consumer.start();
      return (signal: AbortSignal) =>
        signal.aborted ? undefined : consumer.stop();
    },
    ['consumer'],
  );

const app = new DIContainer()
  .addSingleton('consumer', Consumer)
  .namespace('Payments', addPayments)
  .addSingleton(lifecycle.init('sync'), () => {})
  .addSingleton(lifecycle.init('async'), async () => () => {})
  .addInstance('user:repo', 42) // not a stage suffix: not a hook
  .seal();

expectTypeOf(startLifecycle(app)).toEqualTypeOf<Promise<RunningLifecycle>>();
void startLifecycle(app, { concurrent: ['init'], dispose: false });
void startLifecycle(app, { concurrent: true });
void startLifecycle(app, { lifecycle: stages, concurrent: ['migrate'] });
// @ts-expect-error: "inti" is not a stage of the default lifecycle
void startLifecycle(app, { concurrent: ['inti'] });
// @ts-expect-error: "start" is not a stage of `stages`
void startLifecycle(app, { lifecycle: stages, concurrent: ['start'] });

// ---- a key with a stage suffix must produce a hook
const wrong = new DIContainer().addSingleton(lifecycle.init('db'), () => ({
  query: () => 1,
}));
// @ts-expect-error: 'db:init' produces an object, not a hook
void startLifecycle(wrong);
// …but only for the stages being run
void startLifecycle(wrong, { lifecycle: createLifecycle(['migrate']) });

// ---- async containers and the hook type
const asyncApp = new AsyncDIContainer()
  .addSingleton('pool', async () => ({ end: async () => {} }))
  .addSingleton(
    lifecycle.init('warmup'),
    (pool): LifecycleHook =>
      () =>
        pool.end(),
    ['pool'],
  );
void startLifecycle(asyncApp);
void startLifecycle(asyncApp.fork({ isolated: true }));

// ---- the running handle
declare const running: RunningLifecycle;
expectTypeOf(running.stop()).toEqualTypeOf<Promise<void>>();
void running.stop({ signal: AbortSignal.timeout(1000) });
expectTypeOf(running.state).toEqualTypeOf<'started' | 'stopping' | 'stopped'>();
