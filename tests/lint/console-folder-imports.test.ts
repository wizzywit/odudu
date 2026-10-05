import { readFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// A view component, or a module in app/ with companions, is a folder, imported
// as the folder: `#/shared/view/Button`, `#/app/ToastLayer`.
// An import names neither an index.ts nor a file inside another component's
// folder, so what a folder keeps private stays private. A folder's own files
// reach each other by path, since relative imports are banned and its index
// cannot import itself. A test may read a sibling's stylesheet source, as
// `.module.css?raw`. Dynamic import() and vi.mock are held to the same rules.

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const CONSOLE_SOURCES = 'apps/admin-console/src/**/*.{ts,tsx}';
const FIXTURES = 'tests/lint/fixtures/console-folder-imports';
const COMPONENT_FOLDER =
  /^#\/((?:shared|features\/[^/]+)\/view\/[A-Z][A-Za-z0-9]*|app\/[A-Za-z][A-Za-z0-9]*)\/./u;

const MOCKS = new Set(['mock', 'doMock', 'importActual', 'importMock']);

// Static imports and exports, a dynamic import(), and vi.mock and its kin.
function specifiers(file: ts.SourceFile): { text: string; node: ts.Node }[] {
  const found: { text: string; node: ts.Node }[] = [];
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      found.push({ text: node.moduleSpecifier.text, node });
    }
    if (ts.isCallExpression(node)) {
      const [first] = node.arguments;
      const callee = node.expression;
      const loads =
        callee.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isPropertyAccessExpression(callee) &&
          callee.expression.getText() === 'vi' &&
          MOCKS.has(callee.name.text));
      if (loads && first !== undefined && ts.isStringLiteral(first)) {
        found.push({ text: first.text, node });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

// `inside` is the importer's path under src, e.g. `shared/view/Button/Button.tsx`.
export function violations(inside: string, source: string): string[] {
  const kind = inside.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(inside, source, ts.ScriptTarget.Latest, true, kind);
  const found: string[] = [];
  for (const { text, node } of specifiers(file)) {
    const { line } = file.getLineAndCharacterOfPosition(node.getStart());
    const at = String(line + 1);
    if (/\/index(?:\.ts)?$/u.test(text)) found.push(`${at}: ${text} names an index.ts`);
    const folder = COMPONENT_FOLDER.exec(text)?.[1];
    if (
      folder !== undefined &&
      !text.endsWith('.module.css?raw') &&
      !inside.startsWith(`${folder}/`)
    ) {
      found.push(`${at}: ${text} is inside another component's folder`);
    }
  }
  return found;
}

async function read(pattern: string, strip: RegExp): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for await (const file of glob(pattern, { cwd: REPO_ROOT })) {
    const posix = file.split(path.sep).join('/');
    files.set(posix.replace(strip, ''), await readFile(path.join(REPO_ROOT, file), 'utf8'));
  }
  return files;
}

describe("the console's folder imports", { timeout: 60_000 }, () => {
  it('name a folder, never an index.ts or the inside of another component', async () => {
    const files = await read(CONSOLE_SOURCES, /^apps\/admin-console\/src\//u);
    expect(files.size).toBeGreaterThan(100);
    const offenders = [...files].flatMap(([file, source]) =>
      violations(file, source).map((v) => `${file}:${v}`),
    );
    expect(offenders).toEqual([]);
  });

  it('pass every conforming fixture', async () => {
    const files = await read(`${FIXTURES}/pass/src/**/*.{ts,tsx}`, /^.*\/pass\/src\//u);
    expect(files.size).toBeGreaterThan(0);
    for (const [file, source] of files) expect(violations(file, source), file).toEqual([]);
  });

  it('fail every non-conforming fixture', async () => {
    const files = await read(`${FIXTURES}/fail/src/**/*.{ts,tsx}`, /^.*\/fail\/src\//u);
    expect(files.size).toBe(7);
    for (const [file, source] of files) expect(violations(file, source), file).not.toEqual([]);
  });
});
