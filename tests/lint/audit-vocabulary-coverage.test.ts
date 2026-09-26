import { glob, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import ts from 'typescript';
import { afterAll, describe, expect, it } from 'vitest';
import { AUDIT_ACTIONS } from '../../packages/domain-audit/src/index.js';

// An action the vocabulary accepts but no production code writes is an event
// the audit API promises and never returns. The vocabulary's own package is
// excluded because it names every action by construction. A literal counts
// only as the value of an object-literal property — `action: '…'` or an
// action table's entry — so a comment, a type, a `case` label or a
// comparison naming an action is not mistaken for a writer.

const ACTIONS: readonly string[] = Object.values(AUDIT_ACTIONS).flat();

function isProductionSource(file: string): boolean {
  return (
    !file.endsWith('.test.ts') &&
    !file.split('/').includes('testing') &&
    !file.startsWith('packages/domain-audit/')
  );
}

function propertyValues(source: string): string[] {
  const values: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isObjectLiteralExpression(node.parent) &&
      ts.isStringLiteralLike(node.initializer)
    ) {
      values.push(node.initializer.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true));
  return values;
}

export async function actionsWithNoWriter(
  root: string,
  actions: readonly string[],
): Promise<string[]> {
  const unwritten = new Set(actions);
  for await (const file of glob('packages/*/src/**/*.ts', { cwd: root })) {
    if (!isProductionSource(file)) continue;
    const source = await readFile(join(root, file), 'utf8');
    for (const value of propertyValues(source)) unwritten.delete(value);
  }
  return [...unwritten];
}

describe('every audit action has a production writer', () => {
  it('holds across packages/*/src', async () => {
    expect(ACTIONS.length).toBeGreaterThan(20);
    const missing = await actionsWithNoWriter(process.cwd(), ACTIONS);
    expect(missing, `actions no production source writes: ${missing.join(', ')}`).toEqual([]);
  });
});

describe('the check names an action that has lost its writer', () => {
  const roots: string[] = [];

  afterAll(async () => {
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
  });

  async function tree(files: Readonly<Record<string, string>>): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'audit-coverage-'));
    roots.push(root);
    for (const [path, source] of Object.entries(files)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), source);
    }
    return root;
  }

  const [dropped = '', ...kept] = ACTIONS;
  const writers = kept.map((action) => `record({ action: '${action}' });\n`).join('');

  it('reports the one action only a test, a testing helper or the vocabulary names', async () => {
    const root = await tree({
      'packages/fake/src/usecase/writers.ts': writers,
      'packages/fake/src/usecase/writers.test.ts': `'${dropped}';\n`,
      'packages/fake/src/testing/fixtures.ts': `'${dropped}';\n`,
      'packages/domain-audit/src/service/vocabulary.ts': `'${dropped}';\n`,
    });
    expect(await actionsWithNoWriter(root, ACTIONS)).toEqual([dropped]);
  });

  it('reports an action named only in a comment', async () => {
    const root = await tree({
      'packages/fake/src/usecase/writers.ts': `${writers}// action: '${dropped}'\n/* '${dropped}' */\n`,
    });
    expect(await actionsWithNoWriter(root, ACTIONS)).toEqual([dropped]);
  });

  it('reports an action named only in a type', async () => {
    const root = await tree({
      'packages/fake/src/usecase/writers.ts': `${writers}type A = { action: '${dropped}' } | '${dropped}';\n`,
    });
    expect(await actionsWithNoWriter(root, ACTIONS)).toEqual([dropped]);
  });

  it('reports an action named only where it is compared, never written', async () => {
    const root = await tree({
      'packages/fake/src/usecase/writers.ts': `${writers}if (x === '${dropped}') {}\nswitch (x) { case '${dropped}': }\n`,
    });
    expect(await actionsWithNoWriter(root, ACTIONS)).toEqual([dropped]);
  });

  it('accepts the double-quoted spelling', async () => {
    const root = await tree({
      'packages/fake/src/usecase/writers.ts': `${writers}record({ action: "${dropped}" });\n`,
    });
    expect(await actionsWithNoWriter(root, ACTIONS)).toEqual([]);
  });
});
