import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';

// The 1.0 contract: every export of the package entry point with its printed type, and every member
// of exported classes and interfaces. A change here is an API change: update the snapshot on purpose
// (`npx vitest run tests/api-surface.test.ts -u`), add a changeset and, if it breaks, a migration note.
it('public API surface', async () => {
  const entry = join(
    dirname(fileURLToPath(import.meta.url)),
    '../src/index.ts',
  );
  const program = ts.createProgram([entry], {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    lib: ['lib.es2022.d.ts', 'lib.esnext.disposable.d.ts'],
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    allowImportingTsExtensions: true,
    types: [],
  });
  const checker = program.getTypeChecker();
  const moduleSymbol = checker.getSymbolAtLocation(
    program.getSourceFile(entry)!,
  )!;
  const flags =
    ts.TypeFormatFlags.NoTruncation |
    ts.TypeFormatFlags.UseFullyQualifiedType |
    ts.TypeFormatFlags.WriteArrowStyleSignature;
  const lines: string[] = [];
  const undocumented: string[] = [];
  const isInternal = (s: ts.Symbol) =>
    s.getJsDocTags(checker).some((tag) => tag.name === 'internal');
  const documented = (s: ts.Symbol) =>
    ts.displayPartsToString(s.getDocumentationComment(checker)).trim().length >
      0 || s.getJsDocTags(checker).some((tag) => tag.name === 'deprecated');
  const fromLib = (s: ts.Symbol) =>
    s.declarations?.every((d) =>
      program.isSourceFileDefaultLibrary(d.getSourceFile()),
    ) ?? false;

  for (const exported of checker
    .getExportsOfModule(moduleSymbol)
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const symbol =
      exported.flags & ts.SymbolFlags.Alias
        ? checker.getAliasedSymbol(exported)
        : exported;
    const declaration = symbol.declarations?.[0];
    if (!declaration) continue;
    if (!documented(symbol)) undocumented.push(exported.name);
    if (
      ts.isClassDeclaration(declaration) ||
      ts.isInterfaceDeclaration(declaration)
    ) {
      const kind = ts.isClassDeclaration(declaration) ? 'class' : 'interface';
      lines.push(`${kind} ${exported.name}`);
      const type = checker.getDeclaredTypeOfSymbol(symbol);
      for (const member of checker.getPropertiesOfType(type)) {
        if (
          member.name.startsWith('#') ||
          isInternal(member) ||
          fromLib(member)
        )
          continue;
        let name = member.name;
        if (name.startsWith('__@')) {
          // well-known symbols only; internal symbol-keyed members are not API
          if (!name.startsWith('__@asyncDispose@')) continue;
          name = '[Symbol.asyncDispose]';
        }
        const modifiers = ts.getCombinedModifierFlags(
          member.valueDeclaration ?? declaration,
        );
        const prefix =
          modifiers & ts.ModifierFlags.Protected ? 'protected ' : '';
        const memberType = checker.getTypeOfSymbolAtLocation(
          member,
          declaration,
        );
        lines.push(
          `  ${prefix}${name}: ${checker.typeToString(memberType, declaration, flags)}`,
        );
        if (!documented(member)) undocumented.push(`${exported.name}.${name}`);
      }
    } else if (ts.isTypeAliasDeclaration(declaration)) {
      lines.push(`type ${exported.name}`);
    } else {
      const type = checker.getTypeOfSymbolAtLocation(symbol, declaration);
      lines.push(
        `value ${exported.name}: ${checker.typeToString(type, declaration, flags)}`,
      );
    }
  }
  await expect(lines.join('\n') + '\n').toMatchFileSnapshot(
    './__snapshots__/public-api.txt',
  );
  expect(undocumented, 'exports and members without TSDoc').toEqual([]);
});
