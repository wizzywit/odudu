import { readFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// The console's file names say what a file holds (the admin console design,
// "Naming"): a component is PascalCase.tsx, a file exporting a hook is
// useCamelCase.ts(x), and a use* file exports a hook.

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const CONSOLE_SOURCES = 'apps/admin-console/src/**/*.{ts,tsx}';
const FIXTURES = 'tests/lint/fixtures/react-naming';
const EXEMPT = /(?:\.test\.tsx?|^main\.tsx|^vite\.config\.ts)$/u;

type Violation = 'use-file-exports-no-hook' | 'hook-outside-use-file' | 'component-not-pascal';

const HOOK_NAME = /^use[A-Z]/u;
const PASCAL_NAME = /^[A-Z][A-Za-z0-9]*$/u;

type Callable = ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;

function unwrap(node: ts.Expression): ts.Expression {
  let inner = node;
  while (
    ts.isParenthesizedExpression(inner) ||
    ts.isAsExpression(inner) ||
    ts.isSatisfiesExpression(inner) ||
    ts.isNonNullExpression(inner)
  ) {
    inner = inner.expression;
  }
  return inner;
}

function isJsx(node: ts.Expression): boolean {
  const inner = unwrap(node);
  if (ts.isConditionalExpression(inner)) return isJsx(inner.whenTrue) || isJsx(inner.whenFalse);
  return ts.isJsxElement(inner) || ts.isJsxSelfClosingElement(inner) || ts.isJsxFragment(inner);
}

function returnsJsx(fn: Callable): boolean {
  const { body } = fn;
  if (body === undefined) return false;
  if (!ts.isBlock(body)) return isJsx(body);
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found || ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression !== undefined && isJsx(node.expression)) {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(body, visit);
  return found;
}

function hasExportModifier(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  );
}

const ANONYMOUS_DEFAULT = 'default';

// The file's own exported declarations, by the name that classifies them: a
// default export goes by its local name, or by ANONYMOUS_DEFAULT when it has
// none. A re-export from another module is judged in that module.
function exportedDeclarations(file: ts.SourceFile): Map<string, Callable | undefined> {
  const local = new Map<string, Callable | undefined>();
  const exported = new Map<string, Callable | undefined>();
  for (const statement of file.statements) {
    if (ts.isFunctionDeclaration(statement)) {
      const name = statement.name?.text ?? ANONYMOUS_DEFAULT;
      local.set(name, statement);
      if (hasExportModifier(statement)) exported.set(name, statement);
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        const init =
          declaration.initializer === undefined ? undefined : unwrap(declaration.initializer);
        const fn =
          init !== undefined && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
            ? init
            : undefined;
        local.set(declaration.name.text, fn);
        if (hasExportModifier(statement)) exported.set(declaration.name.text, fn);
      }
    }
  }
  for (const statement of file.statements) {
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      const expression = unwrap(statement.expression);
      if (ts.isIdentifier(expression)) {
        if (local.has(expression.text)) exported.set(expression.text, local.get(expression.text));
      } else if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
        exported.set(expression.name?.text ?? ANONYMOUS_DEFAULT, expression);
      }
    }
    if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier !== undefined) continue;
    const clause = statement.exportClause;
    if (clause === undefined || !ts.isNamedExports(clause)) continue;
    for (const element of clause.elements) {
      const localName = (element.propertyName ?? element.name).text;
      const name = element.name.text === ANONYMOUS_DEFAULT ? localName : element.name.text;
      if (local.has(localName)) exported.set(name, local.get(localName));
    }
  }
  return exported;
}

function namingViolations(fileName: string, source: string): Violation[] {
  const tsx = fileName.endsWith('.tsx');
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    tsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const exported = exportedDeclarations(file);
  const names = [...exported.keys()];
  const exportsHook = names.some((name) => HOOK_NAME.test(name));
  const exportsComponent =
    tsx &&
    [...exported].some(
      ([name, fn]) =>
        (PASCAL_NAME.test(name) || name === ANONYMOUS_DEFAULT) &&
        fn !== undefined &&
        returnsJsx(fn),
    );
  const stem = fileName.replace(/\.tsx?$/u, '');

  const violations: Violation[] = [];
  if (HOOK_NAME.test(stem) && !exportsHook) violations.push('use-file-exports-no-hook');
  if (exportsHook && !HOOK_NAME.test(stem)) violations.push('hook-outside-use-file');
  if (exportsComponent && !PASCAL_NAME.test(stem)) violations.push('component-not-pascal');
  return violations;
}

async function read(pattern: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for await (const file of glob(pattern, { cwd: REPO_ROOT })) {
    const posix = file.split(path.sep).join('/');
    files.set(posix, await readFile(path.join(REPO_ROOT, file), 'utf8'));
  }
  return files;
}

const FAILING: Record<string, Violation[]> = {
  'useNothing.ts': ['use-file-exports-no-hook'],
  'hooks.ts': ['hook-outside-use-file'],
  'sessionState.ts': ['hook-outside-use-file'],
  'clientTable.tsx': ['component-not-pascal'],
  'rowParts.tsx': ['component-not-pascal'],
  'defaultArrow.tsx': ['component-not-pascal'],
  'defaultFunction.tsx': ['component-not-pascal'],
  'defaultIdentifier.tsx': ['component-not-pascal'],
  'defaultHook.ts': ['hook-outside-use-file'],
  'listedDefault.ts': ['hook-outside-use-file'],
};

describe("the console's file names", { timeout: 60_000 }, () => {
  it('hold in every console source file', async () => {
    const files = await read(CONSOLE_SOURCES);
    expect([...files.keys()]).toContain('apps/admin-console/src/app/App.tsx');
    const offenders = [...files]
      .filter(([file]) => !EXEMPT.test(path.posix.basename(file)))
      .flatMap(([file, source]) =>
        namingViolations(path.posix.basename(file), source).map((v) => `${file}: ${v}`),
      );
    expect(offenders).toEqual([]);
  });

  it('pass every conforming fixture', async () => {
    const files = await read(`${FIXTURES}/pass/*`);
    expect(files.size).toBeGreaterThan(0);
    for (const [file, source] of files) {
      expect(namingViolations(path.posix.basename(file), source), file).toEqual([]);
    }
  });

  it('fail every non-conforming fixture, each for its own reason', async () => {
    const files = await read(`${FIXTURES}/fail/*`);
    expect([...files.keys()].map((file) => path.posix.basename(file)).sort()).toEqual(
      Object.keys(FAILING).sort(),
    );
    for (const [file, source] of files) {
      const name = path.posix.basename(file);
      expect(namingViolations(name, source), file).toEqual(FAILING[name]);
    }
  });
});
