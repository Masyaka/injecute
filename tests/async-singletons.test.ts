import { describe, expect, it } from 'vitest';
import { defer, DIContainer, InjecuteError } from '../src/index.ts';

const disposable = (name: string, log: string[]) => ({
  name,
  async [Symbol.asyncDispose]() {
    log.push(name);
  },
});

/** A promise with its settle functions, to control when a factory finishes. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('singletons with promise-returning factories', () => {
  it('caches the promise: concurrent resolutions share one creation', async () => {
    let calls = 0;
    const c = new DIContainer().addSingleton('db', async () => {
      calls++;
      return { id: calls };
    });
    const [a, b] = await Promise.all([c.get('db'), c.get('db')]);
    expect(a).toBe(b);
    expect(await c.get('db')).toBe(a);
    expect(calls).toBe(1);
  });

  it('drops a rejected promise, so the next resolution tries again', async () => {
    let calls = 0;
    const c = new DIContainer().addSingleton('db', async () => {
      if (++calls === 1) throw new Error('connection refused');
      return 'connected';
    });
    await expect(c.get('db')).rejects.toThrow('connection refused');
    await expect(c.get('db')).resolves.toBe('connected');
    expect(calls).toBe(2);
  });

  it('wraps a rejection as INJECUTE_RESOLUTION_FAILED with the path and the original cause', async () => {
    const cause = new Error('connection refused');
    const c = new DIContainer()
      .addSingleton('db', () => Promise.reject(cause))
      .addSingleton(
        'repo',
        defer((db: unknown) => ({ db })),
        ['db'],
      );
    const error = await c.get('repo').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InjecuteError);
    expect(error).toMatchObject({
      code: 'INJECUTE_RESOLUTION_FAILED',
      path: ['repo', 'db'],
      cause,
    });
  });

  it('wraps rejections of transients too', async () => {
    const c = new DIContainer().addTransient('t', async () => {
      throw new Error('nope');
    });
    await expect(c.get('t')).rejects.toMatchObject({
      code: 'INJECUTE_RESOLUTION_FAILED',
      path: ['t'],
    });
  });

  it('keeps a replacement when the replaced pending promise rejects later', async () => {
    const pending = deferred<string>();
    const c = new DIContainer().addSingleton('v', () => pending.promise);
    const first = c.get('v');
    c.addSingleton('v', async () => 'replacement', { replace: true });
    const replacement = c.get('v');
    pending.reject(new Error('late'));
    await expect(first).rejects.toThrow('late');
    expect(c.get('v')).toBe(replacement);
  });

  describe('dispose()', () => {
    it('disposes the resolved value, with auto-detection or a disposer function', async () => {
      const log: string[] = [];
      const c = new DIContainer()
        .addSingleton('db', async () => disposable('db', log))
        .addSingleton(
          'mailer',
          async () => ({ close: () => log.push('mailer') }),
          {
            dependencies: [],
            dispose: (mailer) => mailer.close(),
          },
        );
      await c.get('db');
      await c.get('mailer');
      await c.dispose();
      expect(log.sort()).toEqual(['db', 'mailer']);
    });

    it('disposes dependents first when dependencies are async', async () => {
      const log: string[] = [];
      const c = new DIContainer()
        .addSingleton('db', async () => disposable('db', log))
        .addSingleton(
          'repo',
          defer((db: object) => ({ db, ...disposable('repo', log) })),
          ['db'],
        );
      await c.get('repo');
      await c.dispose();
      expect(log).toEqual(['repo', 'db']);
    });

    it('waits for a singleton that is still being created', async () => {
      const log: string[] = [];
      const pending = deferred<ReturnType<typeof disposable>>();
      const c = new DIContainer().addSingleton('db', () => pending.promise);
      void c.get('db');
      const disposing = c.dispose();
      pending.resolve(disposable('db', log));
      await disposing;
      expect(log).toEqual(['db']);
    });

    it('skips singletons whose creation failed', async () => {
      const c = new DIContainer().addSingleton('db', async () => {
        throw new Error('connection refused');
      });
      await expect(c.get('db')).rejects.toThrow();
      await expect(c.dispose()).resolves.toBeUndefined();
    });

    it('skips a pending singleton that rejects during dispose', async () => {
      const pending = deferred<object>();
      const c = new DIContainer().addSingleton('db', () => pending.promise);
      const db = c.get('db');
      const disposing = c.dispose();
      pending.reject(new Error('late'));
      await expect(db).rejects.toThrow('late');
      await expect(disposing).resolves.toBeUndefined();
    });

    it('disposes the resolved value of an addInstance promise registered with dispose', async () => {
      const log: string[] = [];
      const c = new DIContainer().addInstance(
        'db',
        Promise.resolve(disposable('db', log)),
        { dispose: true },
      );
      await c.dispose();
      expect(log).toEqual(['db']);
    });
  });
});
