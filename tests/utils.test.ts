import { expect } from 'chai';
import { describe } from 'mocha';
import { DIContainer } from '../src';
import { defer } from '../src/utils/defer';
import { construct } from '../src/utils/construct';
import { preload } from '../src/utils/preload';
import { createProxyAccessor } from '../src/utils/proxy';

describe('utils', () => {
  describe('proxy', () => {
    const accessor = createProxyAccessor(
      new DIContainer()
        .addInstance('listener', 'Listener')
        .addSingleton('sing', (listener) => `I'm singing for ${listener}`, [
          'listener',
        ]),
    );

    it('reads values', () => {
      expect(accessor.listener).to.be.eq('Listener');
      expect(accessor.sing).to.be.eq("I'm singing for Listener");
    });

    it('throws on write attempt', () => {
      // @ts-expect-error testing
      expect(() => (accessor.listener = '')).to.throw(
        'Set through proxy is not supported',
      );
    });
  });
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
          [],
        )
        .addTransient(
          'transient',
          () => {
            transientCalled = true;
            return {
              name: 'I am a transient',
            };
          },
          [],
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
              name: 'I am singleton',
            };
          },
          [],
        )
        .addTransient(
          'transient',
          () => {
            transientCalled = true;
            return {
              name: 'I am transient',
            };
          },
          [],
        )
        .addInstance('instance', () => {
          instanceCalled = true;
          return {
            name: 'I am an instance',
          };
        });

      preload(container, (k) => typeof k === 'string' && k.startsWith('sing'));
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
          [],
        )
        .addTransient(
          'transient',
          () => {
            transientCalled = true;
            return {
              name: 'I am a transient',
            };
          },
          [],
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

  describe('cobstruct', () => {
    class ClassWithConstructor {
      constructor(
        public readonly field1: number,
        public readonly field2: string,
      ) {}
    }

    it('creates instantiation function', () => {
      const create = construct(ClassWithConstructor);
      const instance = create(1, '2');
      expect(instance).to.be.instanceOf(ClassWithConstructor);
      expect(instance.field1).to.be.a('number');
      expect(instance.field2).to.be.a('string');
    });

    it('works in container', () => {
      const container = new DIContainer()
        .addTransient('number', () => 1, [])
        .addInstance('string', '2')
        .addTransient('x', construct(ClassWithConstructor), [
          'number',
          'string',
        ]);

      const instance = container.get('x');
      expect(instance).to.be.instanceOf(ClassWithConstructor);
      expect(instance.field1).to.be.a('number');
      expect(instance.field2).to.be.a('string');
    });
  });

  describe('defer', () => {
    class ClassWithConstructor {
      constructor(
        public readonly field1: number,
        public readonly field2: string,
      ) {}
    }

    it('creates deferred function', async () => {
      const syncFunction = (n: number, s: string) => n + s;
      const deferred = defer(syncFunction);
      const result = await deferred(1, Promise.resolve('2'));
      expect(result).to.be.eq('12');
    });

    it('allows to add constructor with promised arguments', async () => {
      const container = new DIContainer()
        .addTransient('number', () => Promise.resolve(1), [])
        .addInstance('string', '2')
        .addTransient('x', defer(construct(ClassWithConstructor)), [
          'number',
          'string',
        ]);

      const instance = await container.get('x');
      expect(instance).to.be.instanceOf(ClassWithConstructor);
      expect(instance.field1).to.be.a('number');
      expect(instance.field2).to.be.a('string');
    });
  });
});
