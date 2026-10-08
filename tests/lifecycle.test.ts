import { describe, expect, it } from 'vitest';
import {
  AsyncDIContainer,
  collect,
  createLifecycle,
  createTag,
  DIContainer,
  InjecuteError,
  lifecycle,
  startLifecycle,
  startable,
  startSignal,
  type LifecycleErrorContext,
  type LifecycleHookEvent,
} from '../src/index.ts';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const never = () => new Promise<never>(() => {});

/** A hook that logs `start <name>` and returns an undo that logs `stop <name>`. */
const hook = (log: string[], name: string) => () => {
  log.push(`start ${name}`);
  return () => {
    log.push(`stop ${name}`);
  };
};

const code = (error: unknown) => (error as InjecuteError).code;
/** An InjecuteError's message without the hint and docs lines. */
const first = (error: unknown) => (error as Error).message.split('\n')[0];

describe('createLifecycle()', () => {
  it('builds stage keys', () => {
    const stages = createLifecycle(['migrate', 'init']);
    expect(stages.migrate('schema')).toBe('schema:migrate');
    expect(stages.init('db:primary')).toBe('db:primary:init');
    expect(lifecycle.ready('probe')).toBe('probe:ready');
    expect(Object.keys(stages)).toEqual(['migrate', 'init']);
    expect(Object.isFrozen(stages)).toBe(true);
  });

  it.each([
    [[] as string[], /needs a stage/],
    [[''], /not valid/],
    [['a:b'], /not valid/],
    [['a.b'], /not valid/],
    [['init', 'init'], /listed twice/],
  ])('rejects stages %j', (stages, message) => {
    expect(() => createLifecycle(stages)).toThrow(message);
    expect(() => createLifecycle(stages)).toThrow(
      expect.objectContaining({ code: 'INJECUTE_INVALID_OPTION' }),
    );
  });

  it('rejects an empty hook name', () => {
    expect(() => lifecycle.init('')).toThrow(/needs a name/);
  });
});

describe('startLifecycle()', () => {
  it('runs the stages in order, hooks in registration order, also in namespaces', async () => {
    const log: string[] = [];
    const app = new DIContainer()
      .addSingleton(lifecycle.ready('probe'), hook(log, 'probe'))
      .addSingleton(lifecycle.start('server'), hook(log, 'server'))
      .namespace('Orders', (c) =>
        c
          .addSingleton(lifecycle.init('routes'), hook(log, 'orders routes'))
          .addSingleton(lifecycle.start('consumer'), hook(log, 'consumer')),
      )
      .addSingleton(lifecycle.init('subscriptions'), hook(log, 'subscriptions'))
      .seal();

    const running = await startLifecycle(app);
    expect(running.state).toBe('started');
    expect(running.hooks).toEqual([
      'Orders.routes:init',
      'subscriptions:init',
      'server:start',
      'Orders.consumer:start',
      'probe:ready',
    ]);
    expect(log).toEqual([
      'start orders routes',
      'start subscriptions',
      'start server',
      'start consumer',
      'start probe',
    ]);
  });

  it('stops in reverse order, then disposes the container', async () => {
    const log: string[] = [];
    const app = new DIContainer()
      .addSingleton('pool', () => ({
        [Symbol.dispose]: () => log.push('dispose pool'),
      }))
      .addSingleton(
        lifecycle.init('migrations'),
        (pool) => {
          void pool;
          log.push('start migrations');
        },
        ['pool'],
      )
      .addSingleton(lifecycle.start('server'), hook(log, 'server'))
      .addSingleton(lifecycle.start('consumer'), hook(log, 'consumer'))
      .addSingleton(lifecycle.ready('probe'), hook(log, 'probe'));

    const running = await startLifecycle(app);
    app.get('pool');
    log.length = 0;
    const stopping = running.stop();
    expect(running.state).toBe('stopping');
    expect(running.stop()).toBe(stopping);
    await stopping;
    expect(running.state).toBe('stopped');
    expect(log).toEqual([
      'stop probe',
      'stop consumer',
      'stop server',
      'dispose pool',
    ]);
    expect(() => app.get('pool')).toThrow(/disposed/);
  });

  it('runs custom stages', async () => {
    const log: string[] = [];
    const stages = createLifecycle(['migrate', 'init']);
    const app = new DIContainer()
      .addSingleton(stages.init('cache'), hook(log, 'cache'))
      .addSingleton(stages.migrate('schema'), hook(log, 'schema'))
      .addSingleton(lifecycle.start('server'), hook(log, 'server')); // not a stage of `stages`

    const running = await startLifecycle(app, { lifecycle: stages });
    expect(log).toEqual(['start schema', 'start cache']);
    expect(running.hooks).toEqual(['schema:migrate', 'cache:init']);
  });

  it('awaits async hooks one by one', async () => {
    const log: string[] = [];
    const app = new DIContainer()
      .addSingleton(lifecycle.init('slow'), async () => {
        await sleep(5);
        log.push('slow');
      })
      .addSingleton(lifecycle.init('fast'), () => {
        log.push('fast');
      });
    await startLifecycle(app);
    expect(log).toEqual(['slow', 'fast']);
  });

  it('returns the same promise for the same container, and rejects after stop()', async () => {
    const log: string[] = [];
    const app = new DIContainer().addSingleton(
      lifecycle.start('server'),
      hook(log, 'server'),
    );
    const first = startLifecycle(app);
    expect(startLifecycle(app)).toBe(first);
    await (await first).stop();
    expect(log).toEqual(['start server', 'stop server']);
    await expect(startLifecycle(app)).rejects.toMatchObject({
      code: 'INJECUTE_LIFECYCLE_STOPPED',
    });
  });

  it('works with await using', async () => {
    const log: string[] = [];
    const app = new DIContainer().addSingleton(
      lifecycle.start('server'),
      hook(log, 'server'),
    );
    {
      await using running = await startLifecycle(app);
      expect(running.hooks).toEqual(['server:start']);
    }
    expect(log).toEqual(['start server', 'stop server']);
  });

  it('runs on an isolated fork with its overrides; the root is untouched', async () => {
    const log: string[] = [];
    const app = new DIContainer()
      .addInstance('db', 'real')
      .namespace('Orders', (c) =>
        c.addSingleton(
          lifecycle.init('subscriptions'),
          (db) => {
            log.push(`subscribe with ${db}`);
          },
          ['db'],
        ),
      )
      .seal();

    const test = app.fork({ isolated: true }).addInstance('db', 'fake', {
      replace: true,
    });
    const running = await startLifecycle(test);
    expect(log).toEqual(['subscribe with fake']);
    await running.stop();
    expect(app.get('db')).toBe('real');
  });

  it('keeps the registration order in an isolated fork that replaces a hook', async () => {
    const log: string[] = [];
    const app = new DIContainer()
      .addSingleton(lifecycle.start('a'), hook(log, 'a'))
      .addSingleton(lifecycle.start('b'), hook(log, 'b'))
      .seal();
    const test = app
      .fork({ isolated: true })
      .addSingleton(lifecycle.start('b'), hook(log, 'fake b'), {
        replace: true,
      })
      .addSingleton(lifecycle.start('c'), hook(log, 'c'));
    const running = await startLifecycle(test);
    expect(running.hooks).toEqual(['a:start', 'b:start', 'c:start']);
    expect(log).toEqual(['start a', 'start fake b', 'start c']);
  });

  it('works with an AsyncDIContainer', async () => {
    const log: string[] = [];
    const app = new AsyncDIContainer()
      .addSingleton('pool', async () => {
        await sleep(2);
        return { query: () => 'ok' };
      })
      .addSingleton(
        lifecycle.init('warmup'),
        (pool) => {
          log.push(`warm ${pool.query()}`);
          return () => log.push('cool');
        },
        ['pool'],
      );
    const running = await startLifecycle(app);
    await running.stop();
    expect(log).toEqual(['warm ok', 'cool']);
  });

  describe('validation', () => {
    it('rejects a hook that is not a singleton, before running anything', async () => {
      const log: string[] = [];
      const app = new DIContainer()
        .addSingleton(lifecycle.init('first'), hook(log, 'first'))
        .addInstance('app:ready', true);
      const error = await startLifecycle(app as never).catch((e) => e);
      expect(code(error)).toBe('INJECUTE_INVALID_HOOK');
      expect(error.message).toContain(
        '"app:ready" ends with ":ready", so it is a lifecycle hook, but it is an instance.',
      );
      expect(log).toEqual([]);
      expect(app.get('app:ready')).toBe(true); // not disposed: nothing ran
    });

    it('rejects a transient hook in a namespace', async () => {
      const app = new DIContainer().namespace('Jobs', (c) =>
        c.addTransient(lifecycle.start('scheduler'), () => {}),
      );
      await expect(startLifecycle(app)).rejects.toThrow(
        /"Jobs.scheduler:start" .* it is a transient/,
      );
    });

    it('rejects a hook that depends on another hook', async () => {
      const app = new DIContainer()
        .addSingleton(lifecycle.init('routes'), () => {})
        .addSingleton(lifecycle.start('server'), () => {}, ['routes:init']);
      const error = await startLifecycle(app).catch((e) => e);
      expect(code(error)).toBe('INJECUTE_INVALID_HOOK');
      expect(error.message).toContain(
        'Lifecycle hook "server:start" depends on the lifecycle hook "routes:init".',
      );
    });

    it('rejects a hook that depends on a hook through a service, or decorates a hook', async () => {
      const throughService = new DIContainer()
        .addSingleton(lifecycle.init('routes'), () => {})
        .namespace('Http', (c) =>
          c
            .addSingleton('router', (routes) => routes, ['routes:init'])
            .addSingleton(lifecycle.start('server'), (router) => router, [
              'router',
            ]),
        );
      await expect(startLifecycle(throughService)).rejects.toThrow(
        'Lifecycle hook "Http.server:start" depends on the lifecycle hook "routes:init" (through "Http.router").',
      );

      const decorating = new DIContainer()
        .addSingleton(lifecycle.init('a'), () => {})
        .addSingleton(lifecycle.init('a'), (a) => a, {
          dependencies: ['a:init'],
          replace: true,
        });
      await expect(startLifecycle(decorating)).rejects.toMatchObject({
        code: 'INJECUTE_INVALID_HOOK',
      });
    });

    it('does not remember a rejected start: a corrected call starts', async () => {
      const app = new DIContainer().addSingleton(lifecycle.init('a'), () => {});
      await expect(
        startLifecycle(app, { concurrent: ['nope' as never] }),
      ).rejects.toMatchObject({ code: 'INJECUTE_INVALID_OPTION' });
      const running = await startLifecycle(app);
      expect(running.hooks).toEqual(['a:init']);
    });

    it('rejects a lifecycle not made by createLifecycle() and unknown concurrent stages', async () => {
      const fake = { init: (name: string) => `${name}:init` } as never;
      await expect(
        startLifecycle(new DIContainer(), { lifecycle: fake }),
      ).rejects.toMatchObject({ code: 'INJECUTE_INVALID_OPTION' });
      const app = new DIContainer().addInstance('x', 1);
      await expect(
        startLifecycle(app, { concurrent: ['boot' as never] }),
      ).rejects.toThrow(/"boot"/);
      expect(app.get('x')).toBe(1); // not disposed
    });

    it('leaves keys with ":" that do not end with a stage alone', async () => {
      const app = new DIContainer()
        .addInstance('user:repo', 1)
        .addTransient('cache:redis', () => 2);
      const running = await startLifecycle(app);
      expect(running.hooks).toEqual([]);
    });
  });

  describe('failures', () => {
    it('undoes what ran in reverse, disposes and rejects with the failure', async () => {
      const log: string[] = [];
      const app = new DIContainer()
        .addSingleton('pool', () => ({
          [Symbol.dispose]: () => log.push('dispose pool'),
        }))
        .addSingleton(
          lifecycle.init('a'),
          (pool) => {
            void pool;
            return hook(log, 'a')();
          },
          ['pool'],
        )
        .addSingleton(lifecycle.start('b'), hook(log, 'b'))
        .addSingleton(lifecycle.start('c'), async () => {
          throw new Error('port in use');
        })
        .addSingleton(lifecycle.ready('d'), hook(log, 'd'));

      const error = await startLifecycle(app).catch((e) => e);
      expect(code(error)).toBe('INJECUTE_RESOLUTION_FAILED');
      expect(error.message).toContain(
        'Failed to create "c:start": port in use',
      );
      expect(error.path).toEqual(['c:start']);
      expect(log).toEqual([
        'start a',
        'start b',
        'stop b',
        'stop a',
        'dispose pool',
      ]);
      await expect(startLifecycle(app)).rejects.toBe(error);
    });

    it('reports later failures to onError: rollback and dispose', async () => {
      const reported: [string, LifecycleErrorContext][] = [];
      const app = new DIContainer()
        .addSingleton('pool', () => ({
          [Symbol.dispose]: () => {
            throw new Error('pool gone');
          },
        }))
        .addSingleton(
          lifecycle.init('a'),
          (pool) => {
            void pool;
            return () => {
              throw new Error('broker gone');
            };
          },
          ['pool'],
        )
        .addSingleton(lifecycle.start('b'), () => {
          throw new Error('first');
        });

      const error = await startLifecycle(app, {
        onError: (e, context) => reported.push([first(e)!, context]),
      }).catch((e) => e);
      expect(error.message).toContain('first');
      expect(reported).toEqual([
        [
          'Undoing lifecycle hook "a:init" failed: broker gone',
          { key: 'a:init', during: 'rollback' },
        ],
        ['pool gone', { during: 'dispose' }],
      ]);
    });

    it('does not dispose with dispose: false', async () => {
      const app = new DIContainer()
        .addInstance('db', 'db')
        .addSingleton(lifecycle.init('broken'), () => {
          throw new Error('broken');
        });
      await expect(startLifecycle(app, { dispose: false })).rejects.toThrow(
        /broken/,
      );
      expect(app.get('db')).toBe('db');
    });
  });

  describe('dispose: false', () => {
    it('stop() undoes the hooks and leaves the container alive', async () => {
      const log: string[] = [];
      const app = new DIContainer()
        .addInstance('metrics', 'metrics')
        .addSingleton(lifecycle.start('server'), hook(log, 'server'));
      const running = await startLifecycle(app, { dispose: false });
      await running.stop();
      expect(log).toEqual(['start server', 'stop server']);
      expect(app.get('metrics')).toBe('metrics');
      await expect(startLifecycle(app)).rejects.toMatchObject({
        code: 'INJECUTE_LIFECYCLE_STOPPED',
      });
    });
  });

  describe('stop failures', () => {
    it('runs every undo and the dispose, then rejects with all failures', async () => {
      const log: string[] = [];
      const app = new DIContainer()
        .addSingleton('pool', () => ({
          [Symbol.dispose]: () => {
            throw new Error('pool');
          },
        }))
        .addSingleton(
          lifecycle.init('a'),
          (pool) => {
            void pool;
            return () => log.push('stop a');
          },
          ['pool'],
        )
        .addSingleton(lifecycle.start('b'), () => async () => {
          throw new Error('b');
        });
      const running = await startLifecycle(app);
      const error = await running.stop().catch((e) => e);
      expect(code(error)).toBe('INJECUTE_DISPOSE_FAILED');
      expect((error.cause as AggregateError).errors.map(first)).toEqual([
        'Undoing lifecycle hook "b:start" failed: b',
        'pool',
      ]);
      const undoError = (error.cause as AggregateError).errors[0];
      expect(undoError).toMatchObject({
        code: 'INJECUTE_UNDO_FAILED',
        path: ['b:start'],
      });
      expect(undoError.cause).toEqual(new Error('b'));
      expect(log).toEqual(['stop a']);
      expect(running.state).toBe('stopped');
    });
  });

  describe('concurrent stages', () => {
    it('starts the hooks of a concurrent stage together', async () => {
      const log: string[] = [];
      const slow = (name: string, ms: number) => async () => {
        log.push(`begin ${name}`);
        await sleep(ms);
        log.push(`end ${name}`);
        return () => log.push(`stop ${name}`);
      };
      const app = new DIContainer()
        .addSingleton(lifecycle.init('a'), slow('a', 10))
        .addSingleton(lifecycle.init('b'), slow('b', 1))
        .addSingleton(lifecycle.start('c'), slow('c', 1))
        .addSingleton(lifecycle.start('d'), slow('d', 1));

      const running = await startLifecycle(app, { concurrent: ['init'] });
      expect(log).toEqual([
        'begin a',
        'begin b',
        'end b',
        'end a',
        'begin c',
        'end c',
        'begin d',
        'end d',
      ]);
      expect(running.hooks).toEqual(['a:init', 'b:init', 'c:start', 'd:start']);
      log.length = 0;
      await running.stop();
      expect(log).toEqual(['stop d', 'stop c', 'stop a', 'stop b']);
    });

    it('waits for the whole stage on failure, undoes the others and reports the extra failures', async () => {
      const log: string[] = [];
      const reported: string[] = [];
      const app = new DIContainer()
        .addSingleton(lifecycle.init('ok'), async () => {
          await sleep(5);
          return hook(log, 'ok')();
        })
        .addSingleton(lifecycle.init('first'), async () => {
          await sleep(1);
          throw new Error('first');
        })
        .addSingleton(lifecycle.init('second'), () => {
          throw new Error('second');
        });

      const error = await startLifecycle(app, {
        concurrent: true,
        onError: (e, { key, during }) =>
          reported.push(`${during} ${String(key)} ${(e as Error).message}`),
      }).catch((e) => e);
      expect(error.message).toContain('first'); // first in registration order
      expect(log).toEqual(['start ok', 'stop ok']);
      expect(reported).toEqual([
        expect.stringMatching(/^start second:init .*second/),
      ]);
    });
  });

  describe('signal', () => {
    it('aborts a hanging start, rolls back and undoes the late hook when it settles', async () => {
      const log: string[] = [];
      let finish!: () => void;
      const app = new DIContainer()
        .addSingleton(lifecycle.init('a'), hook(log, 'a'))
        .addSingleton(
          lifecycle.start('broker'),
          () =>
            new Promise<() => void>((resolve) => {
              finish = () => resolve(() => log.push('stop late broker'));
            }),
        )
        .addSingleton(lifecycle.ready('never'), hook(log, 'never'));
      const controller = new AbortController();
      const starting = startLifecycle(app, { signal: controller.signal });
      await sleep(1);
      controller.abort(new Error('timeout'));
      const error = await starting.catch((e) => e);
      expect(code(error)).toBe('INJECUTE_RESOLUTION_FAILED');
      expect(error.message).toContain(
        'Lifecycle hook "broker:start" did not finish: the signal aborted (timeout).',
      );
      expect(log).toEqual(['start a', 'stop a']);
      finish();
      await sleep(1);
      expect(log).toEqual(['start a', 'stop a', 'stop late broker']);
    });

    it('waits for async undo functions when rolling back an aborted start', async () => {
      const log: string[] = [];
      const app = new DIContainer()
        .addSingleton(
          lifecycle.init('server'),
          () => async (signal: AbortSignal) => {
            await sleep(5);
            log.push(`server closed (aborted: ${signal.aborted})`);
          },
        )
        .addSingleton(lifecycle.start('broker'), never);
      await expect(
        startLifecycle(app, { signal: AbortSignal.timeout(5) }),
      ).rejects.toThrow('did not finish');
      expect(log).toEqual(['server closed (aborted: true)']);
    });

    it('rejects at once with an aborted signal', async () => {
      const log: string[] = [];
      const app = new DIContainer().addSingleton(
        lifecycle.init('a'),
        hook(log, 'a'),
      );
      await expect(
        startLifecycle(app, { signal: AbortSignal.abort('no') }),
      ).rejects.toThrow('Lifecycle hook "a:init" did not start');
      expect(log).toEqual([]);
    });

    it('passes the stop signal to undo functions and moves on when it aborts', async () => {
      const log: string[] = [];
      const app = new DIContainer()
        .addSingleton(lifecycle.init('fast'), () => (signal: AbortSignal) => {
          log.push(`stop fast (aborted: ${signal.aborted})`);
        })
        .addSingleton(
          lifecycle.start('hanging'),
          () => (signal: AbortSignal) => {
            signal.addEventListener('abort', () => log.push('force hanging'));
            return never();
          },
        );
      const running = await startLifecycle(app);
      const controller = new AbortController();
      const stopping = running.stop({ signal: controller.signal });
      await sleep(1);
      controller.abort(new Error('grace period over'));
      const error = await stopping.catch((e) => e);
      expect(code(error)).toBe('INJECUTE_DISPOSE_FAILED');
      expect(first((error.cause as AggregateError).errors[0])).toBe(
        'Undoing lifecycle hook "hanging:start" did not finish before the signal aborted: grace period over',
      );
      expect(log).toEqual(['force hanging', 'stop fast (aborted: true)']);
    });

    it('does not wait for a hanging dispose once the stop signal aborts', async () => {
      const app = new DIContainer()
        .addSingleton('pool', () => ({ [Symbol.asyncDispose]: never }))
        .addSingleton(
          lifecycle.init('a'),
          (pool) => {
            void pool;
          },
          ['pool'],
        );
      const running = await startLifecycle(app);
      const error = await running
        .stop({ signal: AbortSignal.timeout(5) })
        .catch((e) => e);
      expect(first((error.cause as AggregateError).errors[0])).toMatch(
        /^Disposing the container did not finish before the signal aborted/,
      );
    });

    it('with an aborted stop signal, still reports what settles at once', async () => {
      const log: string[] = [];
      const app = new DIContainer()
        .addSingleton(lifecycle.init('a'), () => async () => {
          throw new Error('undo failed');
        })
        .addSingleton(lifecycle.start('b'), () => async () => {
          log.push('b undone');
        });
      const running = await startLifecycle(app);
      const error = await running
        .stop({ signal: AbortSignal.abort('now') })
        .catch((e) => e);
      expect((error.cause as AggregateError).errors.map(first)).toEqual([
        'Undoing lifecycle hook "a:init" failed: undo failed',
      ]); // dispose succeeded
      expect(log).toEqual(['b undone']);
    });

    it('prefers the result of a hook that settles as the signal aborts', async () => {
      const controller = new AbortController();
      const app = new DIContainer().addSingleton(
        lifecycle.init('a'),
        async () => {
          controller.abort('late');
          throw new Error('the real failure');
        },
      );
      await expect(
        startLifecycle(app, { signal: controller.signal }),
      ).rejects.toThrow('the real failure');
    });

    it('gives undo functions a signal that never aborts when stop() has none', async () => {
      // (not vi.fn(): mocks are disposable, and dispose() would reset their calls)
      const signals: AbortSignal[] = [];
      const app = new DIContainer().addSingleton(
        lifecycle.init('a'),
        () => (signal: AbortSignal) => signals.push(signal),
      );
      await (await startLifecycle(app)).stop();
      expect(signals).toHaveLength(1);
      expect(signals[0]!.aborted).toBe(false);
    });
  });

  describe('stages are tags', () => {
    it('collects a stage like any tag', () => {
      const stages = createLifecycle(['init', 'start']);
      expect(stages.start.tagName).toBe('start');
      const app = new DIContainer()
        .addSingleton(stages.start('a'), () => {})
        .addSingleton('count', (hooks) => hooks.length, [
          collect(stages.start),
        ]);
      expect(app.get('count')).toBe(1);
    });

    it('rejects a hook that collects a stage, or depends on a service that collects hooks of one', async () => {
      const direct = new DIContainer()
        .addSingleton(lifecycle.init('a'), () => {})
        .addSingleton(lifecycle.ready('b'), (hooks) => void hooks, [
          collect(lifecycle.init),
        ]);
      await expect(startLifecycle(direct)).rejects.toThrow(
        'Lifecycle hook "b:ready" collects the lifecycle hooks of the stage "init".',
      );

      const plugin = createTag('plugin');
      const through = new DIContainer()
        .addSingleton(lifecycle.init('a'), () => {})
        .addSingleton(plugin('p'), (a) => a, ['a:init'])
        .addSingleton('plugins', (plugins) => plugins, [collect(plugin)])
        .addSingleton(lifecycle.start('b'), (plugins) => void plugins, [
          'plugins',
        ]);
      await expect(startLifecycle(through)).rejects.toThrow(
        'Lifecycle hook "b:start" depends on the lifecycle hook "a:init" (through "plugins" → "p:plugin").',
      );
    });
  });

  describe('onHook', () => {
    it('reports each hook and each undo with its duration and failure', async () => {
      const events: Omit<LifecycleHookEvent, 'ms'>[] = [];
      const app = new DIContainer()
        .addSingleton(lifecycle.init('a'), () => () => {})
        .addSingleton(lifecycle.start('b'), async () => {
          await sleep(2);
        })
        .addSingleton(lifecycle.ready('c'), () => () => {
          throw new Error('undo');
        });
      const running = await startLifecycle(app, {
        onHook: ({ ms, ...event }) => {
          expect(ms).toBeGreaterThanOrEqual(0);
          events.push(event);
        },
      });
      await running.stop().catch(() => {});
      expect(events).toEqual([
        { key: 'a:init', stage: 'init', action: 'start' },
        { key: 'b:start', stage: 'start', action: 'start' },
        { key: 'c:ready', stage: 'ready', action: 'start' },
        {
          key: 'c:ready',
          stage: 'ready',
          action: 'undo',
          error: expect.objectContaining({
            message: expect.stringContaining('undo'),
          }),
        },
        { key: 'a:init', stage: 'init', action: 'undo' },
      ]);
    });

    it('reports a failing hook', async () => {
      const events: LifecycleHookEvent[] = [];
      const app = new DIContainer().addSingleton(lifecycle.init('a'), () => {
        throw new Error('boom');
      });
      await startLifecycle(app, { onHook: (e) => events.push(e) }).catch(
        () => {},
      );
      expect(events).toHaveLength(1);
      expect(events[0]!.error).toBeInstanceOf(InjecuteError);
    });
  });

  describe('startable()', () => {
    class Consumer {
      constructor(
        readonly log: string[],
        readonly name: string,
      ) {}
      start() {
        this.log.push(`start ${this.name}`);
      }
      async stop(signal: AbortSignal) {
        this.log.push(`stop ${this.name} (${signal.aborted})`);
      }
    }

    it('registers the service and a start hook that undoes with stop', async () => {
      const log: string[] = [];
      const app = new DIContainer()
        .addInstance('log', log)
        .addInstance('name', 'payments')
        .namespace('Payments', (c) =>
          c.extend(
            startable('consumer', Consumer, ['log', 'name'], {
              start: (consumer) => consumer.start(),
              stop: (consumer, signal) => consumer.stop(signal),
            }),
          ),
        )
        .seal();
      expect(app.get('Payments.consumer')).toBeInstanceOf(Consumer);
      const running = await startLifecycle(app);
      expect(running.hooks).toEqual(['Payments.consumer:start']);
      await running.stop();
      expect(log).toEqual(['start payments', 'stop payments (false)']);
    });

    it('awaits an async start and an async factory, in another stage', async () => {
      const log: string[] = [];
      const app = new DIContainer().extend(
        startable(
          'pool',
          async () => {
            await sleep(1);
            return { connected: true };
          },
          [],
          {
            stage: lifecycle.init,
            start: async (pool) => {
              await sleep(1);
              log.push(`warm ${pool.connected}`);
            },
          },
        ),
      );
      const running = await startLifecycle(app);
      expect(running.hooks).toEqual(['pool:init']);
      expect(log).toEqual(['warm true']);
    });
  });

  describe('startSignal()', () => {
    it('gives hooks the start signal, which aborts with the start', async () => {
      const seen: AbortSignal[] = [];
      const app = new DIContainer()
        .addSingleton(
          lifecycle.init('a'),
          (signal) => {
            seen.push(signal);
          },
          [startSignal],
        )
        .addSingleton(
          lifecycle.start('hanging'),
          (signal) =>
            new Promise<void>((_, reject) =>
              signal.addEventListener('abort', () => reject(signal.reason)),
            ),
          [startSignal],
        );
      const controller = new AbortController();
      const starting = startLifecycle(app, { signal: controller.signal });
      await sleep(1);
      expect(seen[0]!.aborted).toBe(false);
      controller.abort(new Error('timeout'));
      // the hook stopped its own work when the signal aborted: its error is the failure
      await expect(starting).rejects.toThrow(
        'Failed to create "hanging:start": timeout',
      );
      expect(seen[0]).toBe(controller.signal);
    });

    it('never aborts without a signal option, or outside a start', async () => {
      const seen: AbortSignal[] = [];
      const app = new DIContainer().addSingleton(
        lifecycle.init('a'),
        (signal) => void seen.push(signal),
        [startSignal],
      );
      await startLifecycle(app);
      expect(seen[0]!.aborted).toBe(false);
      expect(startSignal().aborted).toBe(false);
    });

    it('reaches startable() hooks', async () => {
      const seen: AbortSignal[] = [];
      const app = new DIContainer().extend(
        startable('worker', class Worker {}, [], {
          start: (_worker, signal) => void seen.push(signal),
        }),
      );
      const signal = new AbortController().signal;
      await startLifecycle(app, { signal });
      expect(seen).toEqual([signal]);
    });
  });

  describe('startable() in an AsyncDIContainer', () => {
    it('starts and stops the resolved service', async () => {
      const log: string[] = [];
      const app = new AsyncDIContainer()
        .addSingleton('url', async () => 'amqp://broker')
        .extend(
          startable(
            'consumer',
            class Consumer {
              constructor(readonly url: string) {}
            },
            ['url'],
            {
              start: (consumer) => void log.push(`start ${consumer.url}`),
              stop: async (consumer) => void log.push(`stop ${consumer.url}`),
            },
          ),
        );
      expect((await app.get('consumer')).url).toBe('amqp://broker');
      const running = await startLifecycle(app);
      await running.stop();
      expect(log).toEqual(['start amqp://broker', 'stop amqp://broker']);
    });
  });
});
