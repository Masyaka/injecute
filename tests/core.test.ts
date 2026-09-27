import { describe, expect, it } from 'vitest';
import { AsyncDIContainer } from '../src/async-container.ts';
import { DIContainer } from '../src/index.ts';

describe('core resolution model', () => {
  describe('values are looked up by presence, not by value (C1)', () => {
    it('resolves singletons that return null, once', () => {
      let calls = 0;
      const c = new DIContainer().addSingleton(
        'n',
        () => {
          calls++;
          return null;
        },
        [],
      );
      expect(c.get('n')).toBeNull();
      expect(c.get('n')).toBeNull();
      expect(calls).toBe(1);
    });

    it('resolves undefined instances and factory results', () => {
      const c = new DIContainer()
        .addInstance('u', undefined)
        .addTransient('t', () => undefined, []);
      expect(c.get('u')).toBeUndefined();
      expect(c.get('t')).toBeUndefined();
      expect(c.has('u')).toBe(true);
    });

    it('still throws for keys that are not registered', () => {
      const c = new DIContainer();
      // @ts-expect-error unknown key
      expect(() => c.get('nope')).toThrow(/No service registered for "nope"/);
    });
  });

  describe('extend (C2)', () => {
    it('accepts an extension that returns a child of the container', () => {
      const c = new DIContainer()
        .addInstance('a', 1)
        .extend((c) => c.fork().addInstance('b', 2));
      expect(c.get('b')).toBe(2);
      expect(c.get('a')).toBe(1);
    });

    it('rejects an extension that returns an unrelated container', () => {
      const c = new DIContainer();
      expect(() => c.extend(() => new DIContainer() as any)).toThrow(
        /not the same container or its child/,
      );
    });
  });

  describe('decorating with a self dependency (C4)', () => {
    it('a child decorates a parent service without replace', () => {
      const parent = new DIContainer().addInstance('log', 'L');
      const child = parent
        .fork()
        .addSingleton('log', (log) => `wrapped(${log})`, ['log']);
      expect(child.get('log')).toBe('wrapped(L)');
      expect(parent.get('log')).toBe('L');
    });

    it('a replacement in the same container decorates the previous definition', () => {
      const c = new DIContainer()
        .addInstance('log', 'L')
        .addSingleton('log', (log) => `a(${log})`, {
          replace: true,
          dependencies: ['log'],
        })
        .addSingleton('log', (log) => `b(${log})`, {
          replace: true,
          dependencies: ['log'],
        });
      expect(c.get('log')).toBe('b(a(L))');
    });

    it('does not mutate the dependencies array passed in (C11)', () => {
      const deps = ['s'] as ['s'];
      new DIContainer()
        .addInstance('s', 1)
        .addSingleton('s', (s) => s + 1, { replace: true, dependencies: deps });
      expect(deps).toEqual(['s']);
    });
  });

  describe('keys (C9)', () => {
    it('lists a key overridden in a child once', () => {
      const c = new DIContainer()
        .addInstance('a', 1)
        .fork()
        .addInstance('a', 2);
      expect(c.keys).toEqual(['a']);
    });
  });

  describe('middlewares run once per get (C7)', () => {
    it('does not run parent middlewares again for parent services', () => {
      const seen: unknown[] = [];
      const root = new DIContainer()
        .use(function (key, next) {
          seen.push(key);
          return next(key);
        })
        .addInstance('a', 1);
      root.fork().fork().get('a');
      expect(seen).toEqual(['a']);
    });
  });

  describe('subclasses (C5)', () => {
    it('fork() keeps the container class', () => {
      const async = new AsyncDIContainer();
      expect(async.fork()).toBeInstanceOf(AsyncDIContainer);
    });

    it('async forks await parent dependencies', async () => {
      const c = new AsyncDIContainer().addSingleton('x', async () => 1);
      const child = c
        .fork()
        .addSingleton('y', ((x: any) => x + 1) as any, ['x'] as any);
      await expect(child.get('y' as any)).resolves.toBe(2);
    });
  });

  describe('cycle detection (E1)', () => {
    it('registers a deep, wide dependency mesh in linear time', () => {
      const c = new DIContainer<any>();
      const start = performance.now();
      let previous: string[] = [];
      for (let layer = 0; layer < 12; layer++) {
        const current: string[] = [];
        for (let i = 0; i < 5; i++) {
          const key = `s${layer}_${i}`;
          c.addSingleton(key, (...args: unknown[]) => args.length, previous);
          current.push(key);
        }
        previous = current;
      }
      // 5^12 paths: exponential path enumeration would never finish.
      expect(performance.now() - start).toBeLessThan(500);
    });

    it('detects a cycle closed by a later registration', () => {
      const c = new DIContainer<any>();
      c.addSingleton('a', (b: unknown) => b, ['b']);
      expect(() => c.addSingleton('b', (a: unknown) => a, ['a'])).toThrow(
        /Circular dependency detected/,
      );
    });
  });

  describe('getRegistration', () => {
    it('describes a registration and where it lives', () => {
      const parent = new DIContainer()
        .addInstance('config', {})
        .addSingleton('db', (config) => ({ config }), ['config']);
      const child = parent.fork().addAlias('database', 'db');
      expect(child.getRegistration('db')).toEqual({
        key: 'db',
        kind: 'singleton',
        depth: 1,
        dependencies: [{ type: 'key', key: 'config' }],
      });
      expect(child.getRegistration('database')).toMatchObject({
        kind: 'alias',
        target: 'db',
        depth: 0,
      });
      expect(child.getRegistration('missing')).toBeUndefined();
    });

    it('links namespace entries to the registration they resolve to', () => {
      const c = new DIContainer().namespace('NS', (ns) =>
        ns.addSingleton('svc', () => 1, []),
      );
      expect(c.getRegistration('NS.svc')).toMatchObject({
        kind: 'namespace-entry',
        namespace: 'NS',
        target: 'svc',
        linked: { kind: 'singleton', key: 'svc' },
      });
    });
  });

  describe('events', () => {
    it('reports the replaced registration', () => {
      const replaced: unknown[] = [];
      const c = new DIContainer()
        .addEventListener('replace', (e) => replaced.push(e.previous.kind))
        .addInstance('a', 1);
      c.addSingleton('a', () => 2, { replace: true, dependencies: [] });
      expect(replaced).toEqual(['instance']);
    });
  });
});
