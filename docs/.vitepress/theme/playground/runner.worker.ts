// Runs playground code off the page: no DOM, a fresh worker per run, terminated after a timeout.
// The library is bundled into this worker; `import … from 'injecute'` in user code is rewritten to it.
import * as injecute from '../../../../src/index.ts';
import type {
  RunnerMessage,
  RunRequest,
  RunResult,
  TraceEntry,
} from './protocol.ts';

const scope = self as unknown as {
  __injecute: typeof injecute;
  process?: { env: Record<string, string | undefined> };
  postMessage(message: RunnerMessage): void;
  onmessage: ((event: MessageEvent<RunRequest>) => void) | null;
};
scope.__injecute = injecute;
scope.process ??= { env: {} };

const logs: string[] = [];
const format = (value: unknown): string => {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};
for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
  console[level] = (...args: unknown[]) =>
    void logs.push(
      `${level === 'log' ? '' : `[${level}] `}${args.map(format).join(' ')}`,
    );
}

/** `import { A, B as C } from 'injecute'` → `const { A, B: C } = globalThis.__injecute;` */
function rewriteImports(code: string): string {
  return code
    .replace(
      /import\s*\{([^}]*)\}\s*from\s*['"]injecute['"];?/g,
      (_m, names: string) =>
        `const {${names.replace(/\b(\w+)\s+as\s+(\w+)/g, '$1: $2')}} = globalThis.__injecute;`,
    )
    .replace(
      /import\s*\*\s*as\s+(\w+)\s+from\s*['"]injecute['"];?/g,
      'const $1 = globalThis.__injecute;',
    )
    .replace(/import\s+['"]injecute['"];?/g, '');
}

const isContainer = (value: unknown): value is injecute.DIContainer<any> =>
  value instanceof injecute.DIContainer;

/** The default export, `app`, `container`, any exported container, or a `create*()` factory's result. */
function pickContainer(
  module: Record<string, unknown>,
): injecute.DIContainer<any> | undefined {
  const exported = Object.entries(module);
  const values = [
    module.default,
    module.app,
    module.container,
    ...exported.map(([, v]) => v),
  ];
  const found = values.find(isContainer);
  if (found) return found;
  const factories = [
    module.default,
    ...exported.filter(([name]) => /^create[A-Z]/.test(name)).map(([, v]) => v),
  ];
  for (const factory of factories) {
    if (typeof factory !== 'function') continue;
    const value = safeCall(factory as (...args: unknown[]) => unknown);
    if (isContainer(value)) return value;
  }
  return undefined;
}

function safeCall(fn: (...args: unknown[]) => unknown): unknown {
  try {
    return fn.length === 0 ? fn() : undefined;
  } catch {
    return undefined;
  }
}

function describe(error: unknown) {
  if (error instanceof injecute.InjecuteError) {
    return { message: error.message, code: error.code, docs: error.docs };
  }
  return {
    message:
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error),
  };
}

scope.onmessage = async ({ data }) => {
  const trace: TraceEntry[] = [];
  try {
    const url = URL.createObjectURL(
      new Blob([rewriteImports(data.code)], { type: 'text/javascript' }),
    );
    const module = (await import(/* @vite-ignore */ url)) as Record<
      string,
      unknown
    >;
    URL.revokeObjectURL(url);
    const container = pickContainer(module);
    if (!container) {
      post({
        type: 'result',
        graph: undefined,
        trace,
        logs,
        error: {
          message:
            'Export the container: `export default container` (or name it `app`).',
        },
      });
      return;
    }
    // Resolve everything once, recording order, nesting and time per service.
    const tracer: injecute.Middleware = (key, next, { depth }) => {
      const entry: TraceEntry = { key: String(key), depth, ms: 0 };
      trace.push(entry);
      const start = performance.now();
      try {
        return next();
      } catch (error) {
        entry.error = describe(error).code ?? 'error';
        throw error;
      } finally {
        entry.ms = performance.now() - start;
      }
    };
    container.use(tracer);
    let error;
    for (const key of container.keys) {
      try {
        container.get(key);
      } catch (e) {
        error ??= describe(e);
      }
    }
    container.unuse(tracer);
    post({
      type: 'result',
      graph: injecute.buildServicesGraph(container),
      trace,
      logs,
      error,
    });
  } catch (error) {
    post({
      type: 'result',
      graph: undefined,
      trace,
      logs,
      error: describe(error),
    });
  }
};

/** Posts a result; if it can't be cloned, posts the reason instead, so the page never waits for nothing. */
function post(result: RunResult) {
  try {
    scope.postMessage(result);
  } catch (error) {
    scope.postMessage({
      type: 'result',
      graph: undefined,
      trace: [],
      logs: [],
      error: describe(error),
    });
  }
}

scope.postMessage({ type: 'ready' });
