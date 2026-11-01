import { fileURLToPath } from 'node:url';
// #region standard-decorators
import ts from 'typescript';
import { defineConfig, type Plugin } from 'vitest/config';

// Vite's transform (Oxc) only lowers legacy decorators, and Node.js doesn't run standard ones yet:
// files with standard decorators go through TypeScript first.
const standardDecorators: Plugin = {
  name: 'standard-decorators',
  enforce: 'pre',
  transform(code, id) {
    if (!id.endsWith('.ts') || !/^\s*@\w/m.test(code)) return;
    const { outputText, sourceMapText } = ts.transpileModule(code, {
      fileName: id,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        sourceMap: true,
      },
    });
    return { code: outputText, map: sourceMapText };
  },
};
// #endregion standard-decorators

export default defineConfig({
  plugins: [standardDecorators],
  resolve: {
    // examples/ import the package by name, like user code does
    alias: {
      injecute: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
