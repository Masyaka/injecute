import { describe, expect, it, vi } from 'vitest';

// Browser production bundles load hints-none.ts instead of hints.ts (the "browser" field and the
// `#injecute-browser-hints` import in package.json; scripts/check-browser-hints.mjs checks that
// bundlers do). This file runs the errors with that swap.
vi.mock('../src/hints.ts', () => import('../src/hints-none.ts'));

const { DIContainer, InjecuteError } = await import('../src/index.ts');

const thrown = (fn: () => unknown): InstanceType<typeof InjecuteError> => {
  try {
    fn();
  } catch (error) {
    if (error instanceof InjecuteError) return error;
    throw error;
  }
  throw new Error('expected an InjecuteError');
};

describe('hints in browser bundles', () => {
  it('prints no hint line, but keeps the message, the docs link and the code', () => {
    const error = thrown(() => new DIContainer().get('missing' as never));
    expect(error.message).toContain('No service registered for "missing"');
    expect(error.message).not.toContain('Hint:');
    expect(error.message).toContain(
      '  Docs: https://masyaka.github.io/injecute/errors/not-registered',
    );
    expect(error.code).toBe('INJECUTE_NOT_REGISTERED');
  });

  it("prints hints again after import 'injecute/hints'", async () => {
    await import('../src/hints-entry.ts');
    const { message } = thrown(() => new DIContainer().get('missing' as never));
    expect(message).toContain(
      '  Hint: Register it (addSingleton / addTransient / addInstance) before resolving it',
    );
  });
});
