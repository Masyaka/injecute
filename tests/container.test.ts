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

describe('injecute container', () => {
  describe('DI container general', () => {
    describe('events', () => {
      it('emit add event', () => {
        let added: ArgumentsKey = '';
        const handler: any = ({ name }: { name: ArgumentsKey }) => {
          added = name;
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
        const container = new DIContainer()
          .addEventListener('reset', handler)
          .addSingleton('singleton', () => 'singleton value', []);
        container.reset();
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
          name,
          value,
        }: {
          name: ArgumentsKey;
          value: any;
        }) => {
          requested = name;
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
      it('creates namespace container with added services', () => {
        const feat = 'feature implementation' as const;
        const container = new DIContainer()
          .namespace('Generic', (generic) =>
            generic
              .addTransient('cfg', () => ({ value: 1 }), [])
              .addInstance('value', '23')
          )
          .namespace('Domain.Context', (namespace, parent) => {
            return namespace
              .addTransient('cfg', parent.getter('Generic.cfg'), [])
              .addSingleton(
                'feature',
                (cfg, value) => feat + cfg.value + value.substring(0, 1),
                ['cfg', parent.getter('Generic.value')]
              );
          });

        const addAliasAndExtendFeature = (
          namespaceContainer: IDIContainer<
            NamespaceServices<typeof container, 'Domain.Context'>
          >
        ) =>
          namespaceContainer
            .addAlias('feature alias', 'feature')
            .addTransient('extendedFeature', (f) => `${f} extended` as const, [
              'feature',
            ]);

        const extendedNamespaceOwnerContainer = container.namespace(
          'Domain.Context',
          addAliasAndExtendFeature
        );
        expect(container.get('Domain.Context.feature')).to.be.eq(
          feat + 1 + '2'
        );
        expect(container.get('Domain.Context')).to.be.instanceOf(DIContainer);
        expect(container.get('Domain.Context').get('feature')).to.be.eq(
          feat + 1 + '2'
        );
        expect(
          extendedNamespaceOwnerContainer.get('Domain.Context.feature alias')
        ).to.be.eq(feat + 1 + '2');
        expect(
          extendedNamespaceOwnerContainer.get('Domain.Context.extendedFeature')
        ).to.be.eq(feat + 1 + '2' + ' extended');
      });
    });
    describe('reset', () => {
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
            []
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
            ['dependency']
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
            []
          )
          .fork();

        container.get('singleton');
        container.get('singleton');
        container.reset();
        container.get('singleton');
        container.reset(true);
        container.get('singleton');
        container.get('singleton');

        expect(singletonFactoryRuns).to.be.eq(2);
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
          []
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
          ['y']
        );
      const c = new DIContainer()
        .addTransient('x', (z: any) => ({ ...z, x: 1 }), ['z'] as any)
        .addTransient('y', (x) => ({ ...x, y: 1 }), ['x']);

      expect(() => c.extend(addZ)).to.throw(CircularDependencyError);
    });
  });
  describe('explicit keys providing container', () => {
    it('will allow to not provide optional dependency key', () => {
      class SrvWithOptionalConstructorArgument {
        constructor(public readonly val: string | undefined = undefined) {}
      }

      const c = new DIContainer().addSingleton(
        's',
        SrvWithOptionalConstructorArgument,
        ['undefined']
      );
      expect(c.get('s')).to.be.instanceOf(SrvWithOptionalConstructorArgument);
    });

    it('will not allow to add service with optional dependency key', () => {
      const addSingletonUndefinedKey = () =>
        new DIContainer().addSingleton(
          optionalDependencySkipKey as any,
          () => optionalDependencySkipKey,
          []
        );
      expect(addSingletonUndefinedKey).to.throw;

      const addInstanceUndefinedKey = () =>
        new DIContainer().addInstance(
          optionalDependencySkipKey as any,
          () => optionalDependencySkipKey
        );
      expect(addInstanceUndefinedKey).to.throw;

      const addTransientUndefinedKey = () =>
        new DIContainer().addTransient(
          optionalDependencySkipKey as any,
          () => optionalDependencySkipKey,
          []
        );
      expect(addTransientUndefinedKey).to.throw;
    });

    it('will restrict adding to container without explicit keys providing', () => {
      const c = new DIContainer();
      expect(() =>
        c.addTransient('d', (arg: any) => {
          console.log(arg);
        })
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
