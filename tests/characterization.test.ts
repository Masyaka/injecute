/**
 * Characterization tests: behaviour of the 0.x API that 1.0 keeps.
 * Tests tagged `changes in S<step>` document behaviour that a later 1.0 step changes on purpose.
 */
import { describe, expect, it } from 'vitest';
import { buildServicesGraph, construct, DIContainer } from '../src';

describe('characterization (kept behaviour)', () => {
  describe('bind', () => {
    it('returns a function that resolves dependencies lazily on each call', () => {
      let calls = 0;
      const c = new DIContainer().addTransient(
        'counter',
        () => {
          calls++;
          return calls;
        },
        [],
      );
      const read = c.bind(['counter'], (counter) => counter * 10);
      expect(calls).toBe(0);
      expect(read()).toBe(10);
      expect(read()).toBe(20);
    });
  });

  describe('injecute', () => {
    it('runs a function with resolved dependencies without registering it', () => {
      const c = new DIContainer().addInstance('a', 2).addInstance('b', 3);
      expect(c.injecute((a, b) => a * b, ['a', 'b'])).toBe(6);
      expect(c.has('injecute')).toBe(false);
    });

    it('accepts inline function dependencies', () => {
      const c = new DIContainer().addInstance('a', 2);
      expect(c.injecute((a, b) => a + b, ['a', () => 40])).toBe(42);
    });
  });

  describe('addAlias', () => {
    it('resolves the aliased service', () => {
      class Service {}
      const c = new DIContainer()
        .addSingleton('service', construct(Service), [])
        .addAlias('alias', 'service');
      expect(c.get('alias')).toBeInstanceOf(Service);
      expect(c.get('alias')).toBe(c.get('service'));
    });

    it('supports an alias of an alias', () => {
      const c = new DIContainer()
        .addInstance('value', 1)
        .addAlias('first', 'value')
        .addAlias('second', 'first');
      expect(c.get('second')).toBe(1);
    });
  });

  describe('has / keys / ownKeys / getParent', () => {
    const parent = new DIContainer().addInstance('p', 1);
    const child = parent.fork().addInstance('c', 2);

    it('has() looks into parents', () => {
      expect(child.has('p')).toBe(true);
      expect(child.has('c')).toBe(true);
      expect(parent.has('c')).toBe(false);
      expect(child.has('missing')).toBe(false);
    });

    it('keys include parent keys, ownKeys do not', () => {
      expect(child.keys).toEqual(expect.arrayContaining(['c', 'p']));
      expect(child.ownKeys).toEqual(['c']);
    });

    it('getParent() returns the parent container', () => {
      expect(child.getParent()).toBe(parent);
      expect(parent.getParent()).toBeUndefined();
    });
  });

  describe('get', () => {
    it('throws for unregistered keys', () => {
      const c = new DIContainer();
      // @ts-expect-error unknown key
      expect(() => c.get('missing')).toThrow(/missing/);
    });

    // changes in S3.1: the option is renamed to `optional`
    it('returns undefined for unregistered keys with allowUnresolved', () => {
      const c = new DIContainer();
      // @ts-expect-error unknown key
      expect(c.get('missing', { allowUnresolved: true })).toBeUndefined();
    });

    it('resolves parent services from a child', () => {
      const parent = new DIContainer().addSingleton('s', () => ({}), []);
      const child = parent.fork();
      expect(child.get('s')).toBe(parent.get('s'));
    });

    it('createResolver() returns a getter', () => {
      const c = new DIContainer().addInstance('v', 'value');
      const getV = c.createResolver('v');
      expect(getV()).toBe('value');
    });
  });

  describe('lifetimes', () => {
    it('singleton factories run once, transient factories run on every get', () => {
      let s = 0;
      let t = 0;
      const c = new DIContainer()
        .addSingleton('s', () => ++s, [])
        .addTransient('t', () => ++t, []);
      c.get('s');
      c.get('s');
      c.get('t');
      c.get('t');
      expect(s).toBe(1);
      expect(t).toBe(2);
    });

    it('instances are returned as they are', () => {
      const value = { v: 1 };
      const c = new DIContainer().addInstance('value', value);
      expect(c.get('value')).toBe(value);
    });

    it('a singleton registered in the parent is shared by forks', () => {
      const parent = new DIContainer().addSingleton('s', () => ({}), []);
      expect(parent.fork().get('s')).toBe(parent.fork().get('s'));
    });
  });

  describe('buildServicesGraph', () => {
    it('lists services with their dependencies', () => {
      const c = new DIContainer()
        .addInstance('config', {})
        .addSingleton('db', (config) => ({ config }), ['config']);
      const graph = buildServicesGraph(c);
      expect(Object.keys(graph)).toEqual(
        expect.arrayContaining(['config', 'db']),
      );
      expect(Object.keys(graph.db?.dependencies ?? {})).toEqual(['config']);
    });
  });
});
