import { readFile } from 'node:fs/promises';
import { glob } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// A usecase integrates and a repository holds state (ADR 0010's amendment):
// every rule, message, failure-to-copy mapping and formatter is a pure
// service function. These are the shapes logic takes in a hook that can be
// found without judgement; guards and `result.ok` choices are orchestration.
//
// CLEAN names what is already clean and widens as each feature is. There is
// no allowlist of exceptions: a file outside CLEAN is unfinished, not waived.

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const SRC = 'apps/admin-console/src';
const FIXTURES = 'tests/lint/fixtures/console-usecase-integration-only';
const CLEAN: readonly string[] = ['shared'];

type Layer = 'usecase' | 'repository';

const WORDS = /(?:[A-Za-z]{2,}[^A-Za-z]+){2}[A-Za-z]{2,}/u;
const COMPARISONS = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.LessThanToken,
  ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.GreaterThanEqualsToken,
]);

function isProse(text: string): boolean {
  return (
    /\s/u.test(text.trim()) && WORDS.test(text.replace(/\s+/gu, ' ').replace(/[^A-Za-z ]+/gu, ' '))
  );
}

// A developer message is not copy: an Error's text, a log line and `defect`.
function isDeveloperText(node: ts.Node): boolean {
  for (let at = node.parent; ts.isExpression(at) || ts.isTemplateSpan(at); at = at.parent) {
    if (ts.isNewExpression(at) && at.expression.getText().endsWith('Error')) return true;
    if (ts.isCallExpression(at)) {
      const callee = at.expression;
      if (callee.kind === ts.SyntaxKind.SuperKeyword) return true;
      if (ts.isIdentifier(callee) && callee.text === 'defect') return true;
      if (ts.isPropertyAccessExpression(callee) && callee.expression.getText() === 'console') {
        return true;
      }
    }
  }
  return false;
}

// `x.status`, or a `status` taken out of the result.
function isStatus(node: ts.Expression): boolean {
  return (
    (ts.isPropertyAccessExpression(node) && node.name.text === 'status') ||
    (ts.isIdentifier(node) && node.text === 'status')
  );
}

function numbers(node: ts.Expression): boolean {
  return (
    ts.isArrayLiteralExpression(node) &&
    node.elements.length > 0 &&
    node.elements.every(
      (element) =>
        ts.isNumericLiteral(element) && Number(element.text) >= 100 && Number(element.text) <= 599,
    )
  );
}

// HTTP-status arrays: `[403, 412].includes(x)` and `new Set([403, 412]).has(x)`.
function isNumberMembership(node: ts.CallExpression): boolean {
  const callee = node.expression;
  if (!ts.isPropertyAccessExpression(callee)) return false;
  const receiver = callee.expression;
  if (callee.name.text === 'includes') return numbers(receiver);
  const [members] = ts.isNewExpression(receiver) ? (receiver.arguments ?? []) : [];
  return (
    callee.name.text === 'has' &&
    ts.isNewExpression(receiver) &&
    receiver.expression.getText() === 'Set' &&
    members !== undefined &&
    numbers(members)
  );
}

function isNumber(node: ts.Expression): boolean {
  return ts.isNumericLiteral(node);
}

function isHook(name: string): boolean {
  return /^use[A-Z0-9]/u.test(name);
}

export function violations(fileName: string, source: string, layer: Layer): string[] {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const found: string[] = [];
  const report = (node: ts.Node, rule: string): void => {
    const { line } = file.getLineAndCharacterOfPosition(node.getStart());
    found.push(`${String(line + 1)}: ${rule}`);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isSwitchStatement(node)) report(node, 'switch');
    if (ts.isIdentifier(node) && node.text === 'Intl' && !ts.isImportSpecifier(node.parent)) {
      report(node, 'Intl');
    }
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      !ts.isImportDeclaration(node.parent) &&
      !ts.isExportDeclaration(node.parent) &&
      isProse(node.text) &&
      !isDeveloperText(node)
    ) {
      report(node, 'prose');
    }
    if (ts.isTemplateExpression(node) && !isDeveloperText(node)) {
      const text = [node.head, ...node.templateSpans.map((span) => span.literal)]
        .map((part) => part.text)
        .join(' ');
      if (isProse(text)) report(node, 'prose');
    }
    if (ts.isBinaryExpression(node) && COMPARISONS.has(node.operatorToken.kind)) {
      const { left, right } = node;
      if ((isStatus(left) && isNumber(right)) || (isNumber(left) && isStatus(right))) {
        report(node, 'status');
      }
    }
    if (ts.isCallExpression(node) && isNumberMembership(node)) report(node, 'status');
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (layer === 'usecase') {
    for (const statement of file.statements) {
      if (
        ts.isFunctionDeclaration(statement) &&
        statement.body !== undefined &&
        statement.name &&
        !isHook(statement.name.text)
      ) {
        report(statement, 'helper');
      }
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          const init = declaration.initializer;
          if (
            ts.isIdentifier(declaration.name) &&
            init !== undefined &&
            (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) &&
            !isHook(declaration.name.text)
          ) {
            report(declaration, 'helper');
          }
        }
      }
    }
  }
  return found;
}

function layerOf(file: string): Layer | null {
  if (file.includes('/usecase/')) return 'usecase';
  if (file.includes('/repository/')) return 'repository';
  return null;
}

async function read(pattern: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for await (const file of glob(pattern, { cwd: REPO_ROOT })) {
    const posix = file.split(path.sep).join('/');
    if (/\.test\.tsx?$/u.test(posix)) continue;
    files.set(posix, await readFile(path.join(REPO_ROOT, file), 'utf8'));
  }
  return files;
}

function scopes(): string[] {
  return CLEAN.flatMap((area) =>
    area === 'shared'
      ? [`${SRC}/shared/{usecase,repository}/**/*.ts`]
      : [`${SRC}/features/${area}/{usecase,repository}/**/*.ts`],
  );
}

describe('the console usecases and repositories that are clean', { timeout: 60_000 }, () => {
  it('hold no logic that belongs to a service', async () => {
    const files = new Map<string, string>();
    for (const pattern of scopes()) {
      for (const [file, source] of await read(pattern)) files.set(file, source);
    }
    expect(files.size).toBeGreaterThan(5);
    const offenders = [...files].flatMap(([file, source]) => {
      const layer = layerOf(file);
      return layer === null ? [] : violations(file, source, layer).map((v) => `${file}:${v}`);
    });
    expect(offenders).toEqual([]);
  });

  it('pass every conforming fixture', async () => {
    const files = await read(`${FIXTURES}/pass/*/*.ts`);
    expect(files.size).toBeGreaterThan(0);
    for (const [file, source] of files) {
      const layer = layerOf(file);
      expect(layer, file).not.toBeNull();
      expect(violations(file, source, layer ?? 'usecase'), file).toEqual([]);
    }
  });

  it('sees a status however it is spelled', () => {
    const forms = [
      'const refused = (r: { status: number }) => r.status === 403;',
      'export function useA(status: number) { return status !== 412; }',
      'export function useB(status: number) { return [403, 412].includes(status); }',
      'export function useC(status: number) { return new Set([403, 412]).has(status); }',
    ];
    for (const form of forms) {
      expect(violations('a/repository/x.ts', form, 'repository'), form).toEqual(['1: status']);
    }
    expect(
      violations('a/repository/x.ts', 'export const a = [1, 2].includes(3);', 'repository'),
    ).toEqual([]);
  });

  it('fail every non-conforming fixture, for the rule it is named after', async () => {
    const files = await read(`${FIXTURES}/fail/*/*.ts`);
    expect(files.size).toBeGreaterThanOrEqual(6);
    for (const [file, source] of files) {
      const layer = layerOf(file);
      expect(layer, file).not.toBeNull();
      const rule = path.posix.basename(file, '.ts');
      const found = violations(file, source, layer ?? 'usecase');
      expect(found.length, file).toBeGreaterThan(0);
      expect(
        found.every((each) => each.endsWith(`: ${rule}`)),
        `${file}: ${found.join(', ')}`,
      ).toBe(true);
    }
  });
});
