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
  ts.typescriptDefaults.setCompilerOptions({
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    lib: ['es2022', 'esnext.disposable', 'webworker'],
    strict: true,
    noEmit: false,
    allowNonTsExtensions: true,
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
