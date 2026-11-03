import { glob, readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// A docs view renders what it is given; decisions are a service function or a usecase result.
// Flagged in non-test .tsx under a `ui` folder: a comparison, arithmetic or concatenation, a
// unary minus (a written-out negative number is a literal), `||`, `??`, `if`, `switch`, a ternary
// not choosing between markup and null, `&&` not rendering markup. Allowed: `x ? <A /> : null`,
// `x && <A />`, a lookup like `LOOKS[tone]`. Not seen: a decision made inside a call
// (`list.filter(...)`) or imported from elsewhere. Not covered: shared/ui/Diagram and the
// Diagram* parts, whose arithmetic is the drawing's geometry. Nothing else is waived.

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const DOCS = 'apps/docs';
const FIXTURES = 'tests/lint/fixtures/docs-view-no-logic';
const DRAWINGS = /(^|\/)shared\/ui\/Diagram[A-Za-z]*\//u;

const COMPARISON = new Set([
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.LessThanToken,
  ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.GreaterThanEqualsToken,
  ts.SyntaxKind.InKeyword,
  ts.SyntaxKind.InstanceOfKeyword,
]);
const ARITHMETIC = new Set([
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.SlashToken,
  ts.SyntaxKind.PercentToken,
  ts.SyntaxKind.AsteriskAsteriskToken,
]);

function lineOf(tree: ts.SourceFile, node: ts.Node): number {
  return tree.getLineAndCharacterOfPosition(node.getStart()).line + 1;
}

function isMarkup(node: ts.Expression): boolean {
  let inner = node;
  while (ts.isParenthesizedExpression(inner)) inner = inner.expression;
  return (
    ts.isJsxElement(inner) ||
    ts.isJsxSelfClosingElement(inner) ||
    ts.isJsxFragment(inner) ||
    inner.kind === ts.SyntaxKind.NullKeyword
  );
}

export function violations(files: Map<string, string>): string[] {
  const found: string[] = [];
  for (const [file, text] of files) {
    if (DRAWINGS.test(file)) continue;
    const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node): void => {
      const report = (what: string): void => {
        found.push(`${file}:${String(lineOf(tree, node))}: ${what}`);
      };
      if (ts.isBinaryExpression(node)) {
        const operator = node.operatorToken.kind;
        if (COMPARISON.has(operator)) report('a comparison');
        else if (ARITHMETIC.has(operator)) report('arithmetic or concatenation');
        else if (operator === ts.SyntaxKind.BarBarToken) report('a default chosen with ||');
        else if (operator === ts.SyntaxKind.QuestionQuestionToken) {
          report('a default chosen with ??');
        } else if (operator === ts.SyntaxKind.AmpersandAmpersandToken && !isMarkup(node.right)) {
          report('&& that does not render markup');
        }
      }
      if (
        ts.isPrefixUnaryExpression(node) &&
        node.operator === ts.SyntaxKind.MinusToken &&
        !ts.isNumericLiteral(node.operand)
      ) {
        report('arithmetic or concatenation');
      }
      if (
        ts.isConditionalExpression(node) &&
        !(isMarkup(node.whenTrue) && isMarkup(node.whenFalse))
      ) {
        report('a ternary that chooses a value');
      }
      if (ts.isIfStatement(node)) report('an if statement');
      if (ts.isSwitchStatement(node)) report('a switch statement');
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
  return found.sort();
}

async function read(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for await (const file of glob('src/**/ui/**/*.tsx', { cwd: path.join(REPO_ROOT, root) })) {
    if (file.endsWith('.test.tsx')) continue;
    const posix = file.split(path.sep).join('/');
    files.set(posix, await readFile(path.join(REPO_ROOT, root, file), 'utf8'));
  }
  return files;
}

describe('views in the docs app', { timeout: 60_000 }, () => {
  it('hold no decision beyond a conditional render', async () => {
    const files = await read(DOCS);
    const names = [...files.keys()];
    expect(names).toContain('src/features/landing/ui/Install/Install.tsx');
    expect(names).toContain('src/shared/ui/Diagram/diagrams.tsx');
    expect(violations(files)).toEqual([]);
  });

  it('pass the conforming fixtures, drawings included', async () => {
    const files = await read(`${FIXTURES}/pass`);
    expect(files.size).toBe(2);
    expect(violations(files)).toEqual([]);
  });

  it('fail every non-conforming fixture, naming the file and the line', async () => {
    const files = await read(`${FIXTURES}/fail`);
    expect(files.size).toBe(4);
    expect(violations(files)).toEqual([
      'src/features/a/ui/Arithmetic.tsx:4: arithmetic or concatenation',
      'src/features/a/ui/Arithmetic.tsx:5: arithmetic or concatenation',
      'src/features/a/ui/Arithmetic.tsx:7: arithmetic or concatenation',
      'src/features/a/ui/Arithmetic.tsx:7: arithmetic or concatenation',
      'src/features/a/ui/Arithmetic.tsx:8: arithmetic or concatenation',
      'src/features/a/ui/Branches.tsx:4: a ternary that chooses a value',
      'src/features/a/ui/Branches.tsx:5: a default chosen with ??',
      'src/features/a/ui/Branches.tsx:6: a default chosen with ||',
      'src/features/a/ui/Branches.tsx:7: an if statement',
      'src/features/a/ui/Branches.tsx:8: a switch statement',
      'src/features/a/ui/Compares.tsx:5: a comparison',
      'src/features/a/ui/Compares.tsx:5: a comparison',
      'src/features/a/ui/Compares.tsx:5: a ternary that chooses a value',
      'src/features/a/ui/Compares.tsx:6: a comparison',
      'src/features/a/ui/Gate.tsx:4: && that does not render markup',
    ]);
  });
});
