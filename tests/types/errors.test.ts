import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Compiles tests/types/fixtures/errors.ts and checks that each `// error: TSxxxx <text>` line reports
// exactly that error. Guards the quality of type errors (the first thing agents read), not just
// whether code compiles.
const fixture = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures/errors.ts',
);

describe('type error messages', () => {
  const source = readFileSync(fixture, 'utf8').split('\n');
  const expectations = source.flatMap((line, index) => {
    const match = /\/\/ error: (TS\d+) (.+)$/.exec(line);
    return match ? [{ line: index + 1, code: match[1]!, text: match[2]! }] : [];
  });
  const program = ts.createProgram([fixture], {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    lib: ['lib.es2022.d.ts', 'lib.esnext.disposable.d.ts'],
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    allowImportingTsExtensions: true,
    skipLibCheck: true,
    types: [],
  });
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .filter((d) => d.file?.fileName === fixture)
    .map((d) => ({
      line: d.file!.getLineAndCharacterOfPosition(d.start!).line + 1,
      code: `TS${d.code}`,
      message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
    }));

  it('has expectations', () => {
    expect(expectations.length).toBeGreaterThan(5);
  });

  for (const { line, code, text } of expectations) {
    it(`line ${line}: ${code} ${text}`, () => {
      const onLine = diagnostics.filter((d) => d.line === line);
      expect(onLine.map((d) => d.code)).toContain(code);
      expect(onLine.find((d) => d.code === code)?.message).toContain(text);
    });
  }

  it('reports no unexpected errors', () => {
    const expected = new Set(expectations.map((e) => e.line));
    expect(diagnostics.filter((d) => !expected.has(d.line))).toEqual([]);
  });
});
