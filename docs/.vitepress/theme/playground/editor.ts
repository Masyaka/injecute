import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

// Every published declaration file, so the editor's types always match the build.
const declarations = import.meta.glob('../../../../lib/**/*.d.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export interface Editor {
  getValue(): string;
  setValue(code: string): void;
  onChange(callback: () => void): void;
  /** JavaScript emitted from the current TypeScript. */
  emit(): Promise<string>;
  setDark(dark: boolean): void;
  dispose(): void;
}

let configured = false;

function configure() {
  if (configured) return;
  configured = true;
  self.MonacoEnvironment = {
    getWorker: (_id, label) =>
      label === 'typescript' || label === 'javascript'
        ? new tsWorker()
        : new editorWorker(),
  };
  const ts = monaco.languages.typescript;
  for (const [path, source] of Object.entries(declarations)) {
    const file = path.replace(/^(\.\.\/)+lib\//, '');
    ts.typescriptDefaults.addExtraLib(
      source,
      `file:///node_modules/injecute/lib/${file}`,
    );
  }
  ts.typescriptDefaults.addExtraLib(
    JSON.stringify({ name: 'injecute', types: './lib/index.d.ts' }),
    'file:///node_modules/injecute/package.json',
  );
  // The worker's shim of node:async_hooks (see async-hooks.ts); Node's own types are too big to load.
  ts.typescriptDefaults.addExtraLib(
    `declare module 'node:async_hooks' {
  export class AsyncLocalStorage<T> {
    getStore(): T | undefined;
    run<R, A extends any[]>(store: T, callback: (...args: A) => R, ...args: A): R;
    exit<R, A extends any[]>(callback: (...args: A) => R, ...args: A): R;
  }
}`,
    'file:///node_modules/@types/node/async_hooks.d.ts',
  );
  ts.typescriptDefaults.setCompilerOptions({
    // ES2016 compiles async/await to generators driven by then(), which carries AsyncLocalStorage
    // stores in the worker; see async-hooks.ts.
    target: ts.ScriptTarget.ES2016,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    lib: ['es2022', 'esnext.disposable', 'webworker'],
    strict: true,
    noEmit: false,
    allowNonTsExtensions: true,
  });
  // 1378: top-level await needs ES2017+. It runs natively, so the ES2016 target doesn't matter to it.
  ts.typescriptDefaults.setDiagnosticsOptions({
    ...ts.typescriptDefaults.getDiagnosticsOptions(),
    diagnosticCodesToIgnore: [1378],
  });
}

/** Monaco registers its TypeScript worker lazily; wait for it instead of failing on the first run. */
async function typescriptWorker() {
  for (let attempt = 0; ; attempt++) {
    try {
      return await monaco.languages.typescript.getTypeScriptWorker();
    } catch (error) {
      if (attempt >= 100) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
}

export function createEditor(
  element: HTMLElement,
  value: string,
  dark: boolean,
): Editor {
  configure();
  const model = monaco.editor.createModel(
    value,
    'typescript',
    monaco.Uri.parse('file:///playground.ts'),
  );
  const editor = monaco.editor.create(element, {
    model,
    theme: dark ? 'vs-dark' : 'vs',
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 13,
    scrollBeyondLastLine: false,
  });
  return {
    getValue: () => model.getValue(),
    setValue: (code) => model.setValue(code),
    onChange: (callback) => void model.onDidChangeContent(callback),
    async emit() {
      const getWorker = await typescriptWorker();
      const worker = await getWorker(model.uri);
      const output = await worker.getEmitOutput(model.uri.toString());
      return output.outputFiles[0]?.text ?? '';
    },
    setDark: (dark) => monaco.editor.setTheme(dark ? 'vs-dark' : 'vs'),
    dispose() {
      editor.dispose();
      model.dispose();
    },
  };
}
