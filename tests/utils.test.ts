import { expect } from 'chai';
import { describe } from 'mocha';
import { DIContainer } from '../src';
import { asNew } from '../src/utils/construct';
import { preload } from '../src/utils/preload';

describe('utils', () => {
  describe('preload', () => {
    it('works without second argument', () => {
      let singletonCalled = false;
      let transientCalled = false;
      let instanceCalled = false;
      const container = new DIContainer()
        .addSingleton(
          'singleton',
          () => {
            singletonCalled = true;
            return {
              name: 'I am a singleton',
            };
          },
          []
        )
        .addTransient(
          'transient',
          () => {
            transientCalled = true;
            return {
              name: 'I am a transient',
            };
          },
          []
        )
        .addInstance('instance', () => {
          instanceCalled = true;
          return {
            name: 'I am a instance',
          };
        });

      preload(container);
      expect(singletonCalled).to.be.true;
      expect(transientCalled).to.be.true;
      expect(instanceCalled).to.be.false;
    });

    it('works with predicate argument', () => {
      let singletonCalled = false;
      let transientCalled = false;
      let instanceCalled = false;
      const container = new DIContainer()
        .addSingleton(
          'singleton',
          () => {
            singletonCalled = true;
            return {
              name: 'I am a singleton',
            };
          },
          []
        )
        .addTransient(
          'transient',
          () => {
            transientCalled = true;
            return {
              name: 'I am a transient',
            };
          },
          []
        )
        .addInstance('instance', () => {
          instanceCalled = true;
          return {
            name: 'I am a instance',
          };
        });

      preload(container, (k) => k.startsWith('sing'));
      expect(singletonCalled).to.be.true;
      expect(transientCalled).to.be.false;
      expect(instanceCalled).to.be.false;
    });

    it('works with array keys argument', () => {
      let singletonCalled = false;
      let transientCalled = false;
      let instanceCalled = false;
      const container = new DIContainer()
        .addSingleton(
          'singleton',
          () => {
            singletonCalled = true;
            return {
              name: 'I am a singleton',
            };
          },
          []
        )
        .addTransient(
          'transient',
          () => {
            transientCalled = true;
            return {
              name: 'I am a transient',
            };
          },
          []
        )
        .addInstance('instance', () => {
          instanceCalled = true;
          return {
            name: 'I am a instance',
          };
        });

      preload(container, ['transient']);
      expect(singletonCalled).to.be.false;
      expect(transientCalled).to.be.true;
      expect(instanceCalled).to.be.false;
    });
  });

  describe('asNew', () => {
    class ClassWithConstructor {
      constructor(
        public readonly field1: number,
        public readonly field2: string
      ) {}
    }

    it('creates instantiation function', () => {
      const construct = asNew(ClassWithConstructor);
      const instance = construct(1, '2');
      expect(instance).to.be.instanceOf(ClassWithConstructor);
      expect(instance.field1).to.be.a('number');
      expect(instance.field2).to.be.a('string');
    });

    it('works in container', () => {
      const container = new DIContainer()
        .addTransient('number', () => 1, [])
        .addInstance('string', '2')
        .addTransient('x', asNew(ClassWithConstructor), ['number', 'string']);

      const instance = container.get('x');
      expect(instance).to.be.instanceOf(ClassWithConstructor);
      expect(instance.field1).to.be.a('number');
      expect(instance.field2).to.be.a('string');
    });
  });
});
