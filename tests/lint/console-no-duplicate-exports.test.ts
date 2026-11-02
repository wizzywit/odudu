import { glob, readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// A declaration copied between two owners (a feature, `shared`, `app`, an e2e
// file) is one change made in two places. Declarations are grouped by name and
// normalised body (leaf tokens: layout, comments, trailing commas and `export`
// do not matter). Exported declarations of any size compare; private functions
// and values from MINIMUM_BODY characters; private types never; in e2e numbers
// are wildcarded. Barrels, tests, `gallery/` and `testing/` are not read. Not
// seen: a copy under another name, nested declarations and class members.

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const CONSOLE = 'apps/admin-console';
const DOCS = 'apps/docs';
const FIXTURES = 'tests/lint/fixtures/console-no-duplicate-exports';
const MINIMUM_BODY = 30;
const ADVICE =
  '; move it to shared and import it, or let the bodies differ if they change for different reasons';
const MODIFIERS = new Set([
  ts.SyntaxKind.ExportKeyword,
  ts.SyntaxKind.DeclareKeyword,
  ts.SyntaxKind.DefaultKeyword,
]);

interface Declaration {
  name: string;
  body: string;
  exported: boolean;
  type: boolean;
  file: string;
  line: number;
}

function leaves(node: ts.Node, skip: ts.Node, out: string[], wildcard: boolean): void {
  const children = node.getChildren();
  if (children.length === 0) {
    if (node.kind === ts.SyntaxKind.EndOfFileToken) return;
    if (MODIFIERS.has(node.kind) && node.parent === skip) return;
    if (ts.isJsxText(node)) {
      const text = node.getText().replace(/\s+/gu, ' ').trim();
      if (text !== '') out.push(text);
      return;
    }
    out.push(wildcard && node.kind === ts.SyntaxKind.NumericLiteral ? '#' : node.getText());
    return;
  }
  for (const child of children) leaves(child, skip, out, wildcard);
}

function bodyOf(node: ts.Node, wildcard: boolean): string {
  const tokens: string[] = [];
  leaves(node, node, tokens, wildcard);
  return tokens
    .filter((token, at) => !(token === ',' && [')', ']', '}'].includes(tokens[at + 1] ?? '')))
    .join(' ');
}

function bound(name: ts.BindingName, out: Set<string>): void {
  if (ts.isIdentifier(name)) out.add(name.text);
  else {
    for (const element of name.elements) {
      if (!ts.isOmittedExpression(element)) bound(element.name, out);
    }
  }
}

function declarations(file: string, source: string, wildcard: boolean): Declaration[] {
  const tree = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: Declaration[] = [];
  const add = (node: ts.Node, name: string, exported: boolean, type: boolean): void => {
    const { line } = tree.getLineAndCharacterOfPosition(node.getStart());
    found.push({ name, body: bodyOf(node, wildcard), exported, type, file, line: line + 1 });
  };
  for (const statement of tree.statements) {
    const exported =
      ts.canHaveModifiers(statement) &&
      (ts.getModifiers(statement) ?? []).some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      );
    if (ts.isVariableStatement(statement)) {
      for (const declarator of statement.declarationList.declarations) {
        const names = new Set<string>();
        bound(declarator.name, names);
        add(declarator, [...names].join(','), exported, false);
      }
    } else if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
      add(statement, statement.name?.text ?? 'default', exported, false);
    } else if (ts.isExportAssignment(statement)) {
      add(statement, 'default', true, false);
    } else if (
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isEnumDeclaration(statement)
    ) {
      add(statement, statement.name.text, exported, true);
    }
  }
  return found;
}

function ownerOf(file: string): string | null {
  if (file.startsWith('e2e/')) return file;
  const parts = file.split('/');
  if (parts[0] !== 'src') return null;
  if (['features', 'entities', 'widgets', 'pages'].includes(parts[1] ?? '')) {
    return `${parts[1] ?? ''}/${parts[2] ?? ''}`;
  }
  if (parts[1] === 'shared' || parts[1] === 'app') return parts[1];
  if (parts[1] === 'gallery' || parts[1] === 'testing') return null;
  return file;
}

function isRead(file: string): boolean {
  return (
    !/\.test\.[cm]?tsx?$/u.test(file) &&
    !/(^|\/)index\.[cm]?ts$/u.test(file) &&
    !file.endsWith('.d.ts') &&
    ownerOf(file) !== null
  );
}

function byPlace(a: string, b: string): number {
  const place = (text: string): [string, number] => {
    const [file = '', line = '0'] = text.split(':', 2);
    return [file, Number(line)];
  };
  const [fileA, lineA] = place(a);
  const [fileB, lineB] = place(b);
  return fileA.localeCompare(fileB) || lineA - lineB;
}

function listed(places: string[]): string {
  const last = places.at(-1) ?? '';
  return places.length === 1 ? last : `${places.slice(0, -1).join(', ')} and ${last}`;
}

// `files` maps a path relative to the console root (`src/…`, `e2e/…`) to its text.
export function violations(files: Map<string, string>): string[] {
  const groups = new Map<string, Declaration[]>();
  for (const [file, source] of files) {
    if (!isRead(file)) continue;
    for (const each of declarations(file, source, file.startsWith('e2e/'))) {
      if (!each.exported && (each.type || each.body.length < MINIMUM_BODY)) continue;
      const key = `${each.name}\u0000${each.body}`;
      groups.set(key, [...(groups.get(key) ?? []), each]);
    }
  }
  return [...groups.values()]
    .filter((group) => new Set(group.map((each) => ownerOf(each.file))).size > 1)
    .map((group) => ({
      name: group[0]?.name ?? '',
      places: group.map((each) => `${each.file}:${String(each.line)}`).sort(byPlace),
    }))
    .sort((a, b) => `${a.name} ${a.places.join()}`.localeCompare(`${b.name} ${b.places.join()}`))
    .map(({ name, places }) => `${name} is declared identically in ${listed(places)}${ADVICE}`);
}

async function read(root: string, patterns: string[]): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const pattern of patterns) {
    for await (const file of glob(pattern, { cwd: path.join(REPO_ROOT, root) })) {
      const posix = file.split(path.sep).join('/');
      files.set(posix, await readFile(path.join(REPO_ROOT, root, file), 'utf8'));
    }
  }
  return files;
}

const TREE = ['src/**/*.{ts,tsx,mts,cts}', 'e2e/**/*.ts'];

describe('declarations in the console', { timeout: 60_000 }, () => {
  it('are not copied between features, shared, app and the e2e files', async () => {
    const files = await read(CONSOLE, TREE);
    const names = [...files.keys()];
    expect(names).toContain('src/shared/services/failure.ts');
    expect(names.filter((file) => file.startsWith('src/features/groups/'))).not.toEqual([]);
    expect(names.filter((file) => file.startsWith('src/features/roles/'))).not.toEqual([]);
    expect(names.filter((file) => file.startsWith('src/features/clients/'))).not.toEqual([]);
    expect(names).toContain('e2e/stack.ts');
    expect(violations(files)).toEqual([]);
  });

  it('are not copied between the docs features or shared either', async () => {
    const files = await read(DOCS, ['src/**/*.{ts,tsx,mts,cts}']);
    const names = [...files.keys()];
    expect(names.filter((file) => file.startsWith('src/features/landing/'))).not.toEqual([]);
    expect(names.filter((file) => file.startsWith('src/shared/'))).not.toEqual([]);
    expect(violations(files)).toEqual([]);
  });

  it('pass every conforming fixture', async () => {
    const files = await read(`${FIXTURES}/pass`, TREE);
    expect(files.size).toBeGreaterThan(10);
    expect(violations(files)).toEqual([]);
  });

  const failing: [string, string[]][] = [
    [
      'function',
      [
        'copyPlan is declared identically in src/features/groups/services/copy.ts:1 and src/features/roles/services/copy.ts:1',
      ],
    ],
    [
      'shared',
      [
        'DESCRIPTION_RULE is declared identically in src/features/clients/services/labels.ts:2 and src/shared/services/labels.ts:1',
      ],
    ],
    [
      'private',
      [
        'segment is declared identically in src/features/clients/adapter/paths.ts:1 and src/features/roles/adapter/paths.ts:3',
      ],
    ],
    [
      'type',
      [
        'RoleValues is declared identically in src/features/groups/services/values.ts:1, src/features/roles/services/values.ts:1 and src/features/scopes/services/values.ts:1',
      ],
    ],
    ['e2e', ['tabTo is declared identically in e2e/groups.spec.ts:1 and e2e/roles.spec.ts:1']],
    [
      'default',
      [
        'default is declared identically in src/features/groups/ui/Page.tsx:1 and src/features/roles/ui/Page.tsx:1',
      ],
    ],
    [
      'destructured',
      [
        'a,b is declared identically in src/features/groups/services/things.mts:1 and src/features/roles/services/things.mts:1',
      ],
    ],
    [
      'tsx',
      [
        'Empty is declared identically in src/features/groups/ui/Empty.tsx:1 and src/features/roles/ui/Empty.tsx:1',
      ],
    ],
  ];

  it.each(failing)('fail the %s fixture, naming every place', async (name, expected) => {
    const files = await read(`${FIXTURES}/fail/${name}`, TREE);
    expect(files.size).toBeGreaterThan(1);
    expect(violations(files)).toEqual(expected.map((finding) => `${finding}${ADVICE}`));
  });
});
