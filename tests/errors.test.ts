import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
  CircularDependencyError,
  construct,
  createProxyAccessor,
  DIContainer,
  errorCodes,
  InjecuteError,
  type InjecuteErrorCode,
} from '../src/index.ts';

const require = createRequire(import.meta.url);
const es5 = require('./fixtures/es5-classes.cjs');
const { BabelClass } = require('./fixtures/babel-class.cjs');

const thrown = (fn: () => unknown): InjecuteError => {
  try {
    fn();
  } catch (error) {
    if (error instanceof InjecuteError) return error;
    throw error;
  }
  throw new Error('expected an InjecuteError');
};

const expectCode = (fn: () => unknown, code: InjecuteErrorCode) => {
  const error = thrown(fn);
  expect(error.code).toBe(code);
  expect(error.docs).toBe(
    `https://masyaka.github.io/injecute/errors/${code
      .replace('INJECUTE_', '')
      .toLowerCase()
      .replaceAll('_', '-')}`,
  );
  expect(error.message).toContain('Hint: ');
  expect(error.message).toContain(`Docs: ${error.docs}`);
  return error;
};

describe('InjecuteError', () => {
  it('every code has a title and a hint', () => {
    for (const [code, { title, hint }] of Object.entries(errorCodes)) {
      expect(code).toMatch(/^INJECUTE_[A-Z_]+$/);
      expect(title.length).toBeGreaterThan(10);
      expect(hint.length).toBeGreaterThan(10);
    }
  });

  it('NOT_REGISTERED suggests similar keys and shows the resolution path', () => {
    const c = new DIContainer()
      .addInstance('logger', console)
      .addSingleton('service', (l: unknown) => l, ['loger' as never]);
    const error = expectCode(() => c.get('service'), 'INJECUTE_NOT_REGISTERED');
    expect(error.message).toContain('No service registered for "loger"');
    expect(error.message).toContain('Did you mean "logger"?');
    expect(error.message).toContain('Resolving: service → loger');
    expect(error.path).toEqual(['service', 'loger']);
  });

  it('NOT_REGISTERED says how many containers were searched', () => {
    const c = new DIContainer().fork().fork();
    expect(thrown(() => c.get('x' as never)).message).toContain(
      'searched this container and 2 parent(s)',
    );
  });

  it('wraps factory errors with the path and keeps the original as cause', () => {
    const original = new Error('connection refused');
    const c = new DIContainer()
      .addSingleton(
        'db',
        () => {
          throw original;
        },
        [],
      )
      .addSingleton('repo', (db) => ({ db }), ['db']);
    const error = expectCode(() => c.get('repo'), 'INJECUTE_RESOLUTION_FAILED');
    expect(error.message).toContain(
      'Failed to create "db": connection refused',
    );
    expect(error.path).toEqual(['repo', 'db']);
    expect(error.cause).toBe(original);
  });

  it('does not wrap an InjecuteError twice', () => {
    const c = new DIContainer()
      .addSingleton('a', (b: unknown) => b, ['b' as never])
      .addSingleton('top', (a) => a, ['a']);
    expect(thrown(() => c.get('top')).code).toBe('INJECUTE_NOT_REGISTERED');
  });

  it('covers registration and usage mistakes', () => {
    const c = new DIContainer().addInstance('a', 1).addInstance('fn', 2);
    expectCode(() => c.addInstance('a', 2), 'INJECUTE_ALREADY_REGISTERED');
    expectCode(
      () => c.addSingleton('bad', 42 as never),
      'INJECUTE_INVALID_FACTORY',
    );
    expectCode(
      () => c.addSingleton('bad', (x: unknown) => x, [{} as never]),
      'INJECUTE_INVALID_DEPENDENCY',
    );
    expectCode(() => c.call('fn', [] as never), 'INJECUTE_NOT_A_FUNCTION');
    expectCode(
      () => c.addEventListener('nope' as never, () => {}),
      'INJECUTE_UNKNOWN_EVENT',
    );
    expectCode(
      () =>
        c.addTransient('t', () => ({}), {
          dependencies: [],
          dispose: () => {},
        } as never),
      'INJECUTE_INVALID_OPTION',
    );
    expectCode(
      () => c.namespace('a', (ns) => ns),
      'INJECUTE_NAMESPACE_CONFLICT',
    );
    expectCode(
      () => c.namespace('ns', () => c as never),
      'INJECUTE_NAMESPACE_RESULT',
    );
    expectCode(
      () => c.extend(() => new DIContainer() as never),
      'INJECUTE_EXTENSION_RESULT',
    );
    const proxy = createProxyAccessor(c) as Record<string, unknown>;
    expectCode(() => {
      proxy.a = 3;
    }, 'INJECUTE_READ_ONLY');
  });

  it('CircularDependencyError is an InjecuteError with the cycle as path', () => {
    const c = new DIContainer<any>();
    c.addSingleton('a', (b: unknown) => b, ['b']);
    const error = expectCode(
      () => c.addSingleton('b', (a: unknown) => a, ['a']),
      'INJECUTE_CIRCULAR_DEPENDENCY',
    );
    expect(error).toBeInstanceOf(CircularDependencyError);
    expect(error.path).toEqual(['b', 'a', 'b']);
  });

  it('DISPOSED after dispose()', async () => {
    const c = new DIContainer().addInstance('a', 1);
    await c.dispose();
    expectCode(() => c.get('a'), 'INJECUTE_DISPOSED');
  });
});

// §4.8: classes that cannot be detected (ES5-compiled, bound) and what happens to each.
describe('classes called without new (ES5 and bound classes)', () => {
  const cases = [
    ['Babel-style _classCallCheck', BabelClass],
    ['TypeScript ES5 class assigning this.x', es5.WithMethods],
    ['TypeScript ES5 class, fields only', es5.FieldsOnly],
    [
      'TypeScript ES5 class with methods that returns undefined',
      es5.MethodsNoThis,
    ],
    ['bound native class', class Native {}.bind(null)],
  ] as const;

  for (const [label, Class] of cases) {
    it(`${label}: CLASS_NOT_CONSTRUCTED with a construct() hint`, () => {
      const c = new DIContainer()
        .addInstance('dep', 'x')
        .addSingleton('svc', Class as (dep: string) => unknown, ['dep']);
      const error = expectCode(
        () => c.get('svc'),
        'INJECUTE_CLASS_NOT_CONSTRUCTED',
      );
      expect(error.message).toContain('Register it as construct(');
    });

    it(`${label}: construct() registers it correctly`, () => {
      const c = new DIContainer()
        .addInstance('dep', 'x')
        .addSingleton('svc', construct(Class as new (dep: string) => object), [
          'dep',
        ]);
      expect(c.get('svc')).toBeInstanceOf(
        label === 'bound native class' ? Object : (Class as new () => object),
      );
    });
  }

  it('an ES5 constructor without methods that ignores this is not detectable (documented limitation)', () => {
    const c = new DIContainer().addSingleton(
      'svc',
      es5.Empty as () => unknown,
      [],
    );
    expect(c.get('svc')).toBeUndefined();
  });

  it('does not misreport ordinary factory TypeErrors', () => {
    const c = new DIContainer().addSingleton(
      'broken',
      function createBroken() {
        (undefined as unknown as { x: number }).x = 1;
      },
      [],
    );
    expect(thrown(() => c.get('broken')).code).toBe(
      'INJECUTE_RESOLUTION_FAILED',
    );
  });
});
