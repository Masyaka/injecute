import { expect } from 'chai';
import { describe, it } from 'mocha';
import {
  ArgumentsKey,
  CircularDependencyError,
  DIContainer,
  IDIContainer,
  IDIContainerExtension,
  NamespaceServices,
  optionalDependencySkipKey,
} from '../src';
import { construct } from '../src';

describe('injecute container', () => {
  describe('DI container general', () => {
    describe('events', () => {
      it('emit add event', () => {
        let added: ArgumentsKey = '';
        const handler: any = ({ key }: { key: ArgumentsKey }) => {
          added = key;
        };
        const container = new DIContainer().addEventListener('add', handler);
        container.addInstance('instance', 'instance value');
        expect(added).to.be.eq('instance');
        container.removeEventListener('add', handler);
        container.addSingleton('singleton', () => 'singleton value', []);
        expect(added).to.be.eq('instance');
      });
      it('emit reset event', () => {
        let resetContainer: any;
        const handler: any = ({ container }: { container: any }) => {
          resetContainer = container;
        };
        const parentHandler = (e: any) => {
          expect(e.keys?.[0]).to.be.eq('singleton');
          expect(e.resetParent).to.be.true;
        };
        const container = new DIContainer()
          .addSingleton('singleton', () => 'parent singleton')
          .addEventListener('reset', parentHandler)
          .fork()
          .addEventListener('reset', handler)
          .addSingleton('singleton', () => 'singleton value', []);
        container.reset({ keys: ['singleton'], resetParent: true });
        expect(resetContainer).to.be.eq(container);
        container.removeEventListener('reset', handler);
        resetContainer = undefined;
        container.reset();
        expect(resetContainer).to.be.undefined;
      });
      it('emit get event', () => {
        let requested: ArgumentsKey = '';
        let gotValue: any;
        const handler: any = ({
          key,
          value,
        }: {
          key: ArgumentsKey;
          value: any;
        }) => {
          requested = key;
          gotValue = value;
        };
        const container = new DIContainer()
          .addEventListener('get', handler)
          .addInstance('instance', 'instance value');

        container.get('instance');
        expect(requested).to.be.eq('instance');
        expect(gotValue).to.be.eq('instance value');

        // should return new value after override
        container.addSingleton('instance', () => 'new value', {
          dependencies: [],
          replace: true,
        });
        container.get('instance');
        expect(requested).to.be.eq('instance');
        expect(gotValue).to.be.eq('new value');

        // after remove handler
        container.removeEventListener('get', handler);
        requested = '';
        gotValue = undefined;
        container.get('instance');
        expect(requested).to.be.eq('');
        expect(gotValue).to.be.undefined;
      });
      it('throws when event is wrong', () => {
        const container = new DIContainer();
        expect(() => container.addEventListener('add', () => {})).to.not.throw;
        expect(() => container.removeEventListener('add', () => {})).to.not
          .throw;
        // @ts-expect-error event not exists
        expect(() => container.addEventListener('added', () => {})).to.throw;
        // @ts-expect-error event not exists
        expect(() => container.removeEventListener('added', () => {})).to.throw;
      });
    });

    describe('namespaces', () => {
      it('Allows to add another container as the namespace', () => {
        const createNamespaceContainer = (
          getDependency: () => {
            name: string;
          },
        ): IDIContainer<{
          namespaceService: { name: string };
        }> =>
          new DIContainer().addSingleton(
            'namespaceService',
            () => {
              const dep = getDependency();
              return {
                name: 'namespace uses ' + dep.name,
              };
            },
            [],
          );

        const parentContainer = new DIContainer()
          .addInstance('parentService', {
            name: 'service from parent container',
          })
          .namespace('Namespace', (c) =>
            createNamespaceContainer(c.createResolver('parentService')),
          );

        expect(parentContainer.get('Namespace.namespaceService'))
          .to.have.property('name')
          .eq('namespace uses service from parent container');
      });
      it('creates namespace container with added services', () => {
        const container = new DIContainer()
          .addInstance('cfg', { configVar: 1 })
          .namespace('Generic', (generic) =>
            generic
              .addTransient('cfg', () => ({ configVar: 1 }), [])
              .addInstance('value', '23'),
          )
          .addInstance('x', 'x')
          .namespace('Domain.Context', (c) => {
            const domainContextNamespaceContainer = c.addSingleton(
              'domainFeatureService',
              (cfg) => ({
                businessMethod: (n: number) => cfg.configVar + n,
              }),
              ['Generic.cfg'],
            );
            return domainContextNamespaceContainer;
          });

        expect(
          container
            .get('Domain.Context.domainFeatureService')
            .businessMethod(41),
        ).to.be.eq(42);
        expect(container.get('Domain.Context')).to.be.instanceOf(DIContainer);
        expect(
          container
            .get('Domain.Context')
            .get('domainFeatureService')
            .businessMethod(41),
        ).to.be.eq(42);

        expect(container.get('Domain.Context').get('Generic.value')).to.be.eq(
          '23',
        );
      });
      it('replaces namespace entry when parent container replaces entry', () => {
        let c = 0;
        const container = new DIContainer()
          .addTransient('count', () => {
            return c++;
          })
          .namespace('NS', (ns) =>
            ns.addSingleton(
              'service',
              (count) => {
                return 'original' + count;
              },
              ['count'],
            ),
          );

        expect(container.get('NS.service')).to.eq('original0');
        expect(container.get('NS.service')).to.eq('original0');
        container.addTransient('NS.service', (count) => 'replaced' + count, {
          replace: true,
          dependencies: ['count'],
        });
        expect(container.get('NS.service')).to.eq('replaced1');
        expect(container.get('NS').get('service')).to.eq('replaced2');

        container.addTransient(
          'NS.service',
          (count) => 'over-replaced-' + count,
          {
            replace: true,
            dependencies: ['count'],
          },
        );
        expect(container.get('NS.service')).to.eq('over-replaced-3');
        expect(container.get('NS').get('service')).to.eq('over-replaced-4');

        container.get('NS').addTransient('service', () => 'final-replacement', {
          replace: true,
          dependencies: [],
        });
        expect(container.get('NS.service')).to.eq('final-replacement');
        expect(container.get('NS').get('service')).to.eq('final-replacement');
      });
      it('replaces deep nested namespace entry', () => {
        const container = new DIContainer()
          .addInstance('rootVal', 'rootVal')
          .namespace('NS1', (ns1) =>
            ns1
              .addSingleton(
                'ns1Service',
                (rootVal) => `ns1Service(${rootVal})`,
                ['rootVal'],
              )
              .namespace('NS2', (ns2) =>
                ns2.addSingleton(
                  'ns2Service',
                  (rootVal, ns1Service) =>
                    `ns2Service(${rootVal}, ${ns1Service})`,
                  ['rootVal', 'ns1Service'],
                ),
              ),
          );

        expect(container.get('NS1.NS2.ns2Service')).to.be.eq(
          'ns2Service(rootVal, ns1Service(rootVal))',
        );
        container.addInstance('rootVal', 'newRootVal', { replace: true });
        expect(container.get('NS1.NS2.ns2Service')).to.be.eq(
          'ns2Service(rootVal, ns1Service(rootVal))',
        );
        container.reset();
        expect(container.get('NS1.NS2.ns2Service')).to.be.eq(
          'ns2Service(newRootVal, ns1Service(newRootVal))',
        );
        container.addSingleton(
          'NS1.ns1Service',
          (rootVal) => `ns1ServiceUpdated(${rootVal})`,
          {
            replace: true,
            dependencies: ['rootVal'],
          },
        );
        container.reset();
        expect(container.get('NS1.NS2.ns2Service')).to.be.eq(
          'ns2Service(newRootVal, ns1ServiceUpdated(newRootVal))',
        );
        expect(container.get('NS1.ns1Service')).to.be.eq(
          'ns1ServiceUpdated(newRootVal)',
        );
        container.addSingleton(
          'NS1.NS2.ns2Service',
          (rootVal) => `ns2ServiceUpdated2(${rootVal})`,
          {
            replace: true,
            dependencies: ['rootVal'],
          },
        );
        expect(container.get('NS1').get('NS2.ns2Service')).to.be.eq(
          'ns2ServiceUpdated2(newRootVal)',
        );
      });
    });
    describe('reset', () => {
      it('removes listed entries, but keeps rest', () => {
        let factory1Calls = 0;
        let factory2Calls = 0;
        const container = new DIContainer()
          .addSingleton('service1', () => {
            factory1Calls++;
            return 'service1-calls-' + factory1Calls;
          })
          .addSingleton('service2', () => {
            factory2Calls++;
            return 'service2-calls-' + factory2Calls;
          });

        container.get('service1');
        container.get('service2');
        expect(factory1Calls).to.eq(1);
        expect(factory2Calls).to.eq(1);
        container.get('service1');
        container.get('service2');
        expect(factory1Calls).to.eq(1);
        expect(factory2Calls).to.eq(1);
        container.reset({ keys: ['service2'] });
        container.get('service1');
        container.get('service2');
        expect(factory1Calls).to.eq(1);
        expect(factory2Calls).to.eq(2);
      });

      it('removes cached singleton instances', () => {
        let singletonFactoryRuns = 0;
        let depFactoryRuns = 0;
        const container = new DIContainer()
          .addTransient(
            'dependency',
            () => {
              depFactoryRuns++;
              return 'dep';
            },
            [],
          )
          .addSingleton(
            'singleton',
            (dep) => {
              singletonFactoryRuns++;
              return {
                dep,
                name: 'singleton',
              };
            },
            ['dependency'],
          );

        container.get('singleton');
        container.get('singleton');
        expect(singletonFactoryRuns).to.be.eq(1);
        expect(depFactoryRuns).to.be.eq(1);
        container.reset();
        container.get('singleton');
        container.get('singleton');

        expect(singletonFactoryRuns).to.be.eq(2);
        expect(depFactoryRuns).to.be.eq(2);
      });

      it('removes cached singleton instances from parent', () => {
        let singletonFactoryRuns = 0;
        const container = new DIContainer()
          .addSingleton(
            'singleton',
            () => {
              singletonFactoryRuns++;
              return {
                name: 'singleton',
              };
            },
            [],
          )
          .fork();

        container.get('singleton');
        container.get('singleton');
        container.reset();
        container.get('singleton');
        container.reset({ resetParent: true });
        container.get('singleton');
        container.get('singleton');

        expect(singletonFactoryRuns).to.be.eq(2);
      });
    });

    describe('call', () => {
      it('calls functor entry', () => {
        const container = new DIContainer()
          .addInstance('dep', () => {
            return 41;
          })
          .addSingleton(
            'functor',
            (dep) => (n: number) => `functorResult=${n + dep()}`,
            ['dep'],
          );

        expect(container.call('functor', [1])).to.be.eq('functorResult=42');
      });

      it('throws when non functor entry called', () => {
        const container = new DIContainer()
          .addInstance('dep', () => {
            return 41;
          })
          .addSingleton('nonFunctor', (dep) => dep() + 1, ['dep']);

        // @ts-expect-error call for non function type entries not allowed
        expect(() => container.call('nonFunctor', [1])).to.throw(
          'Entry "nonFunctor" is not a function and can not be invoked',
        );
      });
    });

    it('should allow to override parent service using parent service', () => {
      const parent = new DIContainer().addTransient('s', () => ({ x: 1 }), []);
      const child = new DIContainer({ parentContainer: parent }).extend((c) => {
        return c.addTransient(
          's',
          () => {
            const s = parent.get('s');
            return { ...s, y: 2 };
          },
          [],
        );
      });
      expect(child.get('s')).to.be.eql({ x: 1, y: 2 });
    });

    it('should prevent creating of circular dependencies', () => {
      const addZ: IDIContainerExtension<any, any> = (container) =>
        container.addTransient(
          'z',
          (y) => ({
            ...y,
            z: 1,
          }),
          ['y'],
        );
      const c = new DIContainer()
        .addTransient('x', (z: any) => ({ ...z, x: 1 }), ['z'] as [any])
        .addTransient('y', (x) => ({ ...x, y: 1 }), ['x']);

      expect(() => c.extend(addZ)).to.throw(CircularDependencyError);
    });
  });
  describe('explicit keys providing container', () => {
    it('will allow to omit third argument for factory with 0 arguments', () => {
      const container = new DIContainer().addSingleton('x', () => ({
        name: 'I am the X.',
      }));
      expect(container.get('x')).to.have.property('name').eq('I am the X.');
    });
    it('will lead to compilation error if third argument not provided for when actually needed', () => {
      const container = new DIContainer()
        // @ts-expect-error expected function with 0 arguments.
        .addSingleton('x', (name: string) => ({
          name,
        }));
      expect(container.get('x')).to.have.property('name').undefined;
    });
    it('will allow to not provide optional dependency key', () => {
      class SrvWithOptionalConstructorArgument {
        constructor(public readonly val: string | undefined = undefined) {}
      }

      const c = new DIContainer().addSingleton(
        's',
        construct(SrvWithOptionalConstructorArgument),
        ['undefined'],
      );
      expect(c.get('s')).to.be.instanceOf(SrvWithOptionalConstructorArgument);
    });

    it('will not allow to add service with optional dependency key', () => {
      const addSingletonUndefinedKey = () =>
        new DIContainer().addSingleton(
          optionalDependencySkipKey as any,
          () => optionalDependencySkipKey,
          [],
        );
      expect(addSingletonUndefinedKey).to.throw;

      const addInstanceUndefinedKey = () =>
        new DIContainer().addInstance(
          optionalDependencySkipKey as any,
          () => optionalDependencySkipKey,
        );
      expect(addInstanceUndefinedKey).to.throw;

      const addTransientUndefinedKey = () =>
        new DIContainer().addTransient(
          optionalDependencySkipKey as any,
          () => optionalDependencySkipKey,
          [],
        );
      expect(addTransientUndefinedKey).to.throw;
    });

    it('will restrict adding to container without explicit keys providing', () => {
      const c = new DIContainer();
      expect(() =>
        // @ts-expect-error
        c.addTransient('d', (arg: any) => {
          console.log(arg);
        }),
      ).to.throw;
    });
    it('will add service with explicit keys provided', () => {
      const c = new DIContainer<{}>();
      const getMultiplied2By2 = () =>
        c
          .addTransient('multiplier', () => 2, { dependencies: [] })
          .addTransient('multiplied2', (n) => 2 * n, ['multiplier'])
          .get('multiplied2');
      expect(getMultiplied2By2()).to.be.eql(4);
    });
    it('should allow to use symbols as keys', () => {
      const c = new DIContainer<{}>();
      const multiplierKey = Symbol('multiplier');
      const multiplierStringKey = Symbol('multiplierString');
      const getMultiplied2By2 = () =>
        c
          .addInstance(multiplierStringKey, '2')
          .addSingleton(multiplierKey, (str) => Number(str), {
            dependencies: [multiplierStringKey],
          })
          .addTransient('multiplied2', (n: number) => 2 * n, {
            dependencies: [multiplierKey],
          })
          .get('multiplied2');
      expect(getMultiplied2By2()).to.be.eql(4);
    });
  });
  describe('middlewares', () => {
    it('allow to use few middlewares', () => {
      const checkpoints: string[] = [];
      new DIContainer()
        .use((name, next) => {
          checkpoints.push('before1');
          const r = next(name);
          checkpoints.push('after1');
          return r;
        })
        .use((name, next) => {
          checkpoints.push('before2');
          const r = next(name);
          checkpoints.push('after2');
          return r;
        })
        .addSingleton('x', () => 'y', [])
        .get('x');

      expect(checkpoints).to.be.eql(['before2', 'before1', 'after1', 'after2']);
    });
    it('child container will use parent middlewares', () => {
      const checkpoints: string[] = [];
      const parentContainer = new DIContainer().use((name, next) => {
        checkpoints.push('before1');
        const r = next(name);
        checkpoints.push('after1');
        return r;
      });

      const r = parentContainer
        .fork()
        .addSingleton('x', () => 'y', [])
        .get('x');

      expect(r).to.be.eql('y');
      expect(checkpoints).to.be.eql(['before1', 'after1']);
    });
  });
});
