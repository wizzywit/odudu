import { glob, readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { PAGE_KINDS } from '../../packages/kernel/src/page-kinds.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

// A themed page's <main> names its kind through the sixth argument of the
// shell's `page(...)`, while its body is filled by `fillPage('<kind>', …)` or
// `fillNotice` (kind `notice`) beside it. This reads every `*-html.ts` as
// TypeScript and holds the two to one kind: a `page(...)` call that fills a
// template passes the kind it filled, a literal that is a key of PAGE_KINDS,
// and a page that fills none passes none. Not seen: a kind computed rather
// than written as a literal, and a renderer that builds its shell elsewhere.

interface Site {
  readonly file: string;
  readonly line: number;
  readonly passed: string | undefined;
  readonly filled: string[];
}

function fillKinds(node: ts.Node): string[] {
  const kinds: string[] = [];
  const visit = (child: ts.Node): void => {
    if (ts.isCallExpression(child) && ts.isIdentifier(child.expression)) {
      const name = child.expression.text;
      const first = child.arguments[0];
      if (name === 'fillNotice') kinds.push('notice');
      if (name === 'fillPage' && first !== undefined && ts.isStringLiteral(first)) {
        kinds.push(first.text);
      }
    }
    ts.forEachChild(child, visit);
  };
  visit(node);
  return kinds;
}

function enclosingFunction(node: ts.Node): ts.Node {
  let current: ts.Node = node;
  while (!ts.isSourceFile(current)) {
    current = current.parent;
    if (ts.isFunctionLike(current)) return current;
  }
  return current;
}

async function sites(): Promise<Site[]> {
  const found: Site[] = [];
  for await (const file of glob('packages/*/src/view/*-html.ts', { cwd: REPO_ROOT })) {
    const text = await readFile(path.join(REPO_ROOT, file), 'utf8');
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'page'
      ) {
        const own = fillKinds(node);
        const kind = node.arguments[5];
        found.push({
          file,
          line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          passed: kind !== undefined && ts.isStringLiteral(kind) ? kind.text : undefined,
          filled: own.length > 0 ? own : fillKinds(enclosingFunction(node)),
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return found;
}

describe('the kind a page names on its main element', () => {
  it('finds the page(...) calls it is meant to hold', async () => {
    expect((await sites()).length).toBeGreaterThan(25);
  });

  it('is the kind its template was filled for, and only a known kind', async () => {
    const wrong: string[] = [];
    for (const site of await sites()) {
      const where = `${site.file}:${String(site.line)}`;
      const kinds = [...new Set(site.filled)];
      if (kinds.length === 0) {
        if (site.passed !== undefined) wrong.push(`${where} names ${site.passed} but fills none`);
      } else if (kinds.length > 1 || site.passed !== kinds[0]) {
        wrong.push(`${where} passes ${site.passed ?? 'no kind'}, fills ${kinds.join(', ')}`);
      } else if (!Object.hasOwn(PAGE_KINDS, kinds[0] ?? '')) {
        wrong.push(`${where} names ${kinds[0] ?? ''}, which is not a page kind`);
      }
    }
    expect(wrong).toEqual([]);
  });
});
