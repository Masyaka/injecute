import { expect } from 'chai';
import { describe } from 'mocha';
import {
  defer,
  construct,
  preload,
  createProxyAccessor,
  createNamedResolvers,
  createResolversTuple,
  addNamedResolvers,
  DIContainer,
} from '../src';
import { setCacheInstance } from '../src/utils/set-cache-instance';

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

    it('allows to narrow and override keys', () => {
      const narrowContainer = new DIContainer()
        .addSingleton('x', () => 'singleton x to expose')
        .addSingleton('y', () => 'singleton y to hide')
        .addSingleton('z', () => 'singleton z to rename');
      const narrowProxy = createProxyAccessor(narrowContainer, {
        keys: ['x', ['z', 'renamedZ']],
      });
      expect(narrowProxy.x).to.be.eq('singleton x to expose');
      // @ts-expect-error
      expect(narrowProxy.y).to.be.undefined;
      // @ts-expect-error
      expect(narrowProxy.z).to.be.undefined;
      expect(narrowProxy.renamedZ).to.be.eq('singleton z to rename');
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

  describe('construct', () => {
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

    it('returns promise', async () => {
      const container = new DIContainer()
        .addTransient('number', () => Promise.resolve(1), [])
        .addInstance('string', '2')
        .addTransient(
          'deferredString',
          defer(
            (num: number, str: string): Promise<string> =>
              Promise.resolve(str + num),
          ),
          ['number', 'string'],
        )
        .addTransient(
          'dependedOnDeferred',
          (deferredString) =>
            deferredString.then((deferredStringValue) => {
              // @ts-expect-error no promise of promise;
              expect(deferredStringValue.then).is.undefined;
              return `deferred string was ${deferredStringValue}`;
            }),
          ['deferredString'],
        );

      const deferredString = await container.get('deferredString');
      const dependedOnDeferred = await container.get('dependedOnDeferred');
      expect(deferredString).to.be.a.string;
      expect(dependedOnDeferred).to.be.eq('deferred string was 21');
    });
  });

  describe('resolvers', () => {
    it('adds named resolvers', () => {
      const provider = new DIContainer()
        .addInstance('x', 'x')
        .addInstance('number', 1);

      const namedResolvers = createNamedResolvers(provider, [
        'number',
        ['x', 'string'],
      ]);

      const consumer = new DIContainer().extend(
        addNamedResolvers(namedResolvers),
      );

      expect(consumer.get('number')).to.be.eq(1);
      expect(consumer.get('string')).to.be.eq('x');
    });

    it('creates resolvers tuple', () => {
      const container = new DIContainer()
        .addInstance('x', 'x')
        .addInstance('y', 'y')
        .addInstance('z', 'z');

      const [getX, getY, getZ] = createResolversTuple(container, [
        'x',
        'y',
        'z',
      ]);
      expect(getX()).eq('x');
      expect(getY()).eq('y');
      expect(getZ()).eq('z');
    });

    it('creates named resolvers', () => {
      const container = new DIContainer()
        .addInstance('x', 'x')
        .addInstance('y', 'y')
        .addInstance('z', 'z');

      const zSymbol = Symbol('z');
      const resolvers = createNamedResolvers(container, [
        'x',
        ['y', 'aliasForY'],
        ['z', zSymbol],
      ]);
      expect(resolvers.x()).eq('x');
      expect(resolvers.aliasForY()).eq('y');
      expect(resolvers[zSymbol]()).eq('z');
    });
  });
});

describe('setCacheInstance', () => {
  it('overrides service until reset()', () => {
    let factoryCalls = 0;
    const container = new DIContainer()
      .addSingleton('service', () => {
        factoryCalls++;
        return {
          method(p: string) {
            return p + p;
          },
        };
      })
      .addTransient(
        'serviceUsageResult',
        (service) => {
          return service.method('hello');
        },
        ['service'],
      );

    expect(factoryCalls).to.eq(0);
    expect(container.get('serviceUsageResult')).to.eq('hellohello');
    expect(factoryCalls).to.eq(1);
    expect(container.get('serviceUsageResult')).to.eq('hellohello');
    expect(factoryCalls).to.eq(1);
    container.reset();
    setCacheInstance(container, 'service', {
      method(p) {
        return p + 1;
      },
    });
    expect(container.get('serviceUsageResult')).to.eq('hello1');
    expect(factoryCalls).to.eq(1);
    container.reset();
    expect(container.get('serviceUsageResult')).to.eq('hellohello');
    expect(factoryCalls).to.eq(2);
    expect(container.get('serviceUsageResult')).to.eq('hellohello');
    expect(factoryCalls).to.eq(2);
  });
});
