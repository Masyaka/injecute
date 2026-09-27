import { describe, expect, it } from 'vitest';
import { AsyncDIContainer } from '../src/async-container';

describe('async container', () => {
  it('do basic required async stuff', async () => {
    const x = new AsyncDIContainer()
      .addSingleton('str', () => Promise.resolve('str'))
      .addSingleton('number', () => 123)
      .addSingleton(
        'syncServiceWithAsyncDeps',
        (str, number) => ({ str, number }),
        ['str', 'number'],
      )
      .addSingleton(
        'asyncService',
        async (dep, str) => {
          return {
            dep,
            str,
          };
        },
        ['syncServiceWithAsyncDeps', 'str'],
      );
    const syncServiceWithAsyncDeps = x.get('syncServiceWithAsyncDeps');
    expect(syncServiceWithAsyncDeps).toBeInstanceOf(Promise);
    await (syncServiceWithAsyncDeps as any).then((v: any) => {
      expect(typeof v.number).toBe('number');
      expect(typeof v.str).toBe('string');
      return x.get('asyncService').then((s: any) => {
        expect(typeof s.dep.number).toBe('number');
        expect(typeof s.dep.str).toBe('string');
        expect(typeof s.str).toBe('string');
      });
    });
  });
});
