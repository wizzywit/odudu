import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// An approval leaves `pending` through one function, `decideApproval`, which
// checks that the caller is the owner. The repository's `decide` has no such
// check, so a second caller would be a decision no owner made.

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const REPOSITORY = 'packages/domain-agents/src/repository/approvals.ts';
const WRITER = 'packages/protocol-oidc/src/usecase/approvals.ts';
const TEST = /\.test\.tsx?$/u;

// A member named `decide` read by dot, by bracket or by destructuring.
function reachesDecide(fileName: string, source: string): boolean {
  if (!source.includes('decide')) return false;
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  let found = false;
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && node.name.text === 'decide') found = true;
    if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      node.argumentExpression.text === 'decide'
    ) {
      found = true;
    }
    if (ts.isBindingElement(node) && (node.propertyName ?? node.name).getText(file) === 'decide') {
      found = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

function sourceFiles(): string[] {
  return execFileSync('git', ['ls-files', '--', 'packages', 'apps', 'tools'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .filter((file) => /\.tsx?$/u.test(file) && !TEST.test(file) && !file.includes('/tests/'));
}

describe('the decision of an approval', () => {
  it('is written only by decideApproval', () => {
    const files = sourceFiles();
    expect(files).toContain(WRITER);
    expect(files).toContain(REPOSITORY);
    const offenders = files
      .filter((file) => file !== REPOSITORY && file !== WRITER)
      .filter((file) => reachesDecide(file, readFileSync(path.join(REPO_ROOT, file), 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('is found by reference, however it is spelled', () => {
    expect(reachesDecide('a.ts', 'repo.decide(id, "approved", "console", now);')).toBe(true);
    expect(reachesDecide('a.ts', 'repo["decide"](id);')).toBe(true);
    expect(reachesDecide('a.ts', 'const { decide } = repo;')).toBe(true);
    expect(reachesDecide('a.ts', 'const decide = 1;')).toBe(false);
    expect(reachesDecide('a.ts', 'const note = "decide later";')).toBe(false);
  });
});
