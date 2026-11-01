import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CLIENT_RULES, NO_TENANT_IN_SCOPE, PAGE_KINDS } from '@odudu/kernel';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// A page a tenant's theme can reach builds its body through its package's
// page filler: every `page()` call in a `*-html.ts` takes its second argument
// from `fillPage` or `fillNotice`, directly or through a `const` in the same
// file. A renderer that cannot is named in NO_TENANT_IN_SCOPE with a reason.
// Not seen: a body built in a route file, or a filler reached through a helper
// that is not a `const` in the renderer. Read as syntax, so a comment or a
// string naming the filler counts for nothing.
const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..');
const PACKAGES_DIR = join(REPO_ROOT, 'packages');
const APPS_DIR = join(REPO_ROOT, 'apps');
const FIXTURE = join(REPO_ROOT, 'tests/lint/fixtures/renderer-without-theme');
const TEMPLATE_MODULE = '#/view/template';
const SHELL_MODULE = '#/view/document';

interface Renderer {
  readonly path: string;
  readonly text: string;
}

async function renderersUnder(dir: string): Promise<Renderer[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = await Promise.all(
    entries.map(async (entry): Promise<Renderer[]> => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return renderersUnder(path);
      if (!entry.name.endsWith('-html.ts')) return [];
      return [{ path, text: await readFile(path, 'utf8') }];
    }),
  );
  return found.flat();
}

async function allRenderers(): Promise<Renderer[]> {
  const roots = [
    ...(await readdir(PACKAGES_DIR)).map((name) => join(PACKAGES_DIR, name, 'src/view')),
    ...(await readdir(APPS_DIR)).map((name) => join(APPS_DIR, name, 'src')),
  ];
  return (await Promise.all(roots.map(renderersUnder))).flat();
}

interface Reading {
  readonly pageCalls: number;
  // `page()` calls whose body does not come from a filler.
  readonly unfilled: number;
  readonly fillerCalls: number;
  readonly kinds: readonly string[];
  readonly unknownKinds: readonly string[];
}

const importedNames = (file: ts.SourceFile, module: string): Map<string, string> => {
  const names = new Map<string, string>();
  for (const statement of file.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== module
    ) {
      continue;
    }
    const named = statement.importClause?.namedBindings;
    if (named === undefined || !ts.isNamedImports(named)) continue;
    for (const element of named.elements) {
      names.set(element.name.text, (element.propertyName ?? element.name).text);
    }
  }
  return names;
};

function read(text: string): Reading {
  const file = ts.createSourceFile('renderer.ts', text, ts.ScriptTarget.Latest, true);
  const fillers = importedNames(file, TEMPLATE_MODULE);
  const pageNames = [...importedNames(file, SHELL_MODULE)]
    .filter(([, original]) => original === 'page')
    .map(([local]) => local);
  const inits = new Map<string, ts.Expression[]>();
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      inits.set(node.name.text, [...(inits.get(node.name.text) ?? []), node.initializer]);
    }
    if (ts.isCallExpression(node)) calls.push(node);
    ts.forEachChild(node, visit);
  };
  visit(file);

  const calledFiller = (call: ts.CallExpression): string | null =>
    ts.isIdentifier(call.expression) && fillers.has(call.expression.text)
      ? (fillers.get(call.expression.text) ?? null)
      : null;
  const isFilled = (expression: ts.Expression, seen: Set<string>): boolean => {
    if (ts.isParenthesizedExpression(expression)) return isFilled(expression.expression, seen);
    if (ts.isCallExpression(expression)) return calledFiller(expression) !== null;
    if (!ts.isIdentifier(expression) || seen.has(expression.text)) return false;
    const held = inits.get(expression.text) ?? [];
    seen.add(expression.text);
    return held.length > 0 && held.every((init) => isFilled(init, seen));
  };

  const pageCalls = calls.filter(
    (call) => ts.isIdentifier(call.expression) && pageNames.includes(call.expression.text),
  );
  const kinds: string[] = [];
  const unknownKinds: string[] = [];
  let fillerCalls = 0;
  for (const call of calls) {
    const original = calledFiller(call);
    if (original === null) continue;
    fillerCalls++;
    if (original === 'fillNotice') kinds.push('notice');
    if (original !== 'fillPage') continue;
    const [kind] = call.arguments;
    if (kind !== undefined && ts.isStringLiteral(kind) && Object.hasOwn(PAGE_KINDS, kind.text)) {
      kinds.push(kind.text);
    } else {
      unknownKinds.push(kind?.getText(file) ?? '(none)');
    }
  }
  return {
    pageCalls: pageCalls.length,
    unfilled: pageCalls.filter((call) => {
      const body = call.arguments[1];
      return body === undefined || !isFilled(body, new Set());
    }).length,
    fillerCalls,
    kinds,
    unknownKinds,
  };
}

const relative = (path: string): string => path.slice(REPO_ROOT.length + 1);

const unthemed = (renderers: readonly Renderer[]): string[] =>
  renderers
    .filter((r) => {
      const reading = read(r.text);
      return reading.pageCalls === 0 || reading.unfilled > 0;
    })
    .map((r) => relative(r.path));

const unknownKinds = (renderers: readonly Renderer[]): string[] =>
  renderers.filter((r) => read(r.text).unknownKinds.length > 0).map((r) => relative(r.path));

const exempt = (path: string): boolean => Object.hasOwn(NO_TENANT_IN_SCOPE, relative(path));

describe('every page renderer reaches a theme', () => {
  it('finds the renderers, so an empty scan cannot pass', async () => {
    expect((await allRenderers()).length).toBeGreaterThanOrEqual(15);
  });

  it('is themeable or named in NO_TENANT_IN_SCOPE with a reason', async () => {
    const renderers = await allRenderers();
    const themeable = renderers.filter((r) => !exempt(r.path));
    expect(unthemed(themeable)).toEqual([]);
    expect(unknownKinds(renderers)).toEqual([]);
    for (const [file, reason] of Object.entries(NO_TENANT_IN_SCOPE)) {
      expect(reason.trim().length, file).toBeGreaterThan(20);
    }
  });

  it('names no renderer that does not exist, or that is themeable after all', async () => {
    const renderers = await allRenderers();
    const onDisk = new Set(renderers.map((r) => relative(r.path)));
    for (const file of Object.keys(NO_TENANT_IN_SCOPE)) expect(onDisk.has(file), file).toBe(true);
    const exemptButFilled = renderers
      .filter((r) => exempt(r.path) && read(r.text).fillerCalls > 0)
      .map((r) => relative(r.path));
    expect(exemptButFilled).toEqual([]);
  });

  it('gives every themeable renderer a client rule, and no other', async () => {
    const themeable = (await allRenderers())
      .filter((r) => !exempt(r.path))
      .map((r) => relative(r.path))
      .sort();
    expect(Object.keys(CLIENT_RULES).sort()).toEqual(themeable);
    for (const [file, rule] of Object.entries(CLIENT_RULES)) {
      expect(rule.why.trim().length, file).toBeGreaterThan(20);
    }
  });

  it('fills every page kind from some renderer', async () => {
    const filled = new Set((await allRenderers()).flatMap((r) => read(r.text).kinds));
    expect([...Object.keys(PAGE_KINDS)].filter((kind) => !filled.has(kind))).toEqual([]);
  });
});

describe('the check refuses what it is meant to', () => {
  const fixture = async (name: string): Promise<Renderer[]> =>
    (await renderersUnder(FIXTURE)).filter((r) => r.path.endsWith(`/${name}`));

  it('reads the fixture directory', async () => {
    expect((await renderersUnder(FIXTURE)).length).toBeGreaterThanOrEqual(6);
  });

  it('fails a renderer whose body is its own markup', async () => {
    expect(unthemed(await fixture('unthemed-html.ts'))).toHaveLength(1);
  });

  it('is not satisfied by the import and the call written in a comment or a string', async () => {
    expect(unthemed(await fixture('commented-fill-html.ts'))).toHaveLength(1);
  });

  it('is not satisfied by a filler called for something other than the page body', async () => {
    expect(unthemed(await fixture('fills-elsewhere-html.ts'))).toHaveLength(1);
  });

  it('fails a file that has one themed page and one that is not', async () => {
    expect(unthemed(await fixture('mixed-html.ts'))).toHaveLength(1);
  });

  it('refuses a page kind that does not exist', async () => {
    expect(unknownKinds(await fixture('unknown-kind-html.ts'))).toHaveLength(1);
  });

  it('accepts a body filled directly or through a const', async () => {
    expect(unthemed(await fixture('themed-html.ts'))).toEqual([]);
  });
});
