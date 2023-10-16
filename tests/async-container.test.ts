import { expect } from 'chai';
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
    expect(syncServiceWithAsyncDeps)
      .to.have.property('then')
      .to.be.a('function');
    await (syncServiceWithAsyncDeps as any).then((v) => {
      expect(v.number).to.be.a('number');
      expect(v.str).to.be.a('string');
      return x.get('asyncService').then((s) => {
        expect(s.dep.number).to.be.a('number');
        expect(s.dep.str).to.be.a('string');
        expect(s.str).to.be.a('string');
      });
    });
  });
});
