import { glob, readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// `styles.name` on a CSS module that has no `.name` is `undefined`, so the
// element renders unstyled and nothing complains. Every reference in non-test
// source must be a class its module defines, and every class a module defines
// must be used: referenced, or named by a `composes:`. A module's binding is
// its default import, or a named import of a name an `export { default as x }`
// re-exports. A computed lookup or the binding used whole is reported. Classes
// inside `:global(…)` are not the module's. Not seen: `.scss` modules, and
// bindings made by `require` or a dynamic import.

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const CONSOLE = 'apps/admin-console';
const DOCS = 'apps/docs';
const FIXTURES = 'tests/lint/fixtures/console-css-module-classes-defined';
const CLASS = /\.(-?[_a-zA-Z][\w-]*)/gu;

function blank(text: string): string {
  return text.replace(/[^\n]/gu, ' ');
}

function stripped(css: string): string {
  return css
    .replace(/\/\*[\s\S]*?\*\//gu, blank)
    .replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/gu, blank)
    .replace(/url\([^)]*\)/gu, blank)
    .replace(/:global\([^)]*\)/gu, blank);
}

// The classes a stylesheet composes, with the module each comes from.
function composedBy(file: string, css: string): { module: string; name: string }[] {
  const composed: { module: string; name: string }[] = [];
  for (const match of css
    .replace(/\/\*[\s\S]*?\*\//gu, blank)
    .matchAll(/composes:\s*([^;}]+?)\s*(?:from\s*([^;}]+))?;/gu)) {
    const from = (match[2] ?? '').trim().replace(/^["']|["']$/gu, '');
    const module = from === '' ? file : resolve(file, from);
    for (const name of (match[1] ?? '').split(/\s+/u)) {
      if (name !== '') composed.push({ module, name });
    }
  }
  return composed;
}

// Each class a module defines, with the line of its first appearance.
function classesOf(css: string): Map<string, number> {
  const classes = new Map<string, number>();
  for (const match of stripped(css).matchAll(CLASS)) {
    const before = css.slice(0, match.index);
    const name = match[1] ?? '';
    if (!classes.has(name)) classes.set(name, before.split('\n').length);
  }
  return classes;
}

function byPlace(a: string, b: string): number {
  const place = (text: string): [string, number] => {
    const [file = '', line = '0'] = text.split(':', 2);
    return [file, Number(line)];
  };
  const [fileA, lineA] = place(a);
  const [fileB, lineB] = place(b);
  return fileA.localeCompare(fileB) || lineA - lineB || a.localeCompare(b);
}

function resolve(from: string, specifier: string): string {
  if (specifier.startsWith('#/')) return `src/${specifier.slice(2)}`;
  // The docs app's alias for its own root.
  if (specifier.startsWith('@site/')) return specifier.slice('@site/'.length);
  return path.posix.join(path.posix.dirname(from), specifier);
}

function isModuleImport(specifier: string): boolean {
  return specifier.endsWith('.module.css');
}

interface Reference {
  file: string;
  line: number;
  local: string;
  name: string | null;
  module: string;
}

function treeOf(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

// `export { default as recordTab } from './RecordTab.module.css'`.
function reexports(trees: Map<string, ts.SourceFile>): Map<string, string> {
  const named = new Map<string, string>();
  for (const [file, tree] of trees) {
    for (const statement of tree.statements) {
      if (
        ts.isExportDeclaration(statement) &&
        statement.moduleSpecifier !== undefined &&
        ts.isStringLiteral(statement.moduleSpecifier) &&
        isModuleImport(statement.moduleSpecifier.text) &&
        statement.exportClause !== undefined &&
        ts.isNamedExports(statement.exportClause)
      ) {
        for (const element of statement.exportClause.elements) {
          named.set(element.name.text, resolve(file, statement.moduleSpecifier.text));
        }
      }
    }
  }
  return named;
}

function bindingsOf(
  file: string,
  tree: ts.SourceFile,
  named: Map<string, string>,
): Map<string, string> {
  const bindings = new Map<string, string>();
  for (const statement of tree.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue;
    }
    const specifier = statement.moduleSpecifier.text;
    const clause = statement.importClause;
    if (clause === undefined) continue;
    if (isModuleImport(specifier) && clause.name !== undefined) {
      bindings.set(clause.name.text, resolve(file, specifier));
    }
    if (clause.namedBindings !== undefined && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        const module = named.get((element.propertyName ?? element.name).text);
        if (module !== undefined) bindings.set(element.name.text, module);
      }
    }
  }
  return bindings;
}

function referencesIn(
  file: string,
  tree: ts.SourceFile,
  bindings: Map<string, string>,
): Reference[] {
  const found: Reference[] = [];
  const add = (node: ts.Node, local: string, name: string | null): void => {
    const module = bindings.get(local);
    if (module === undefined) return;
    const line = tree.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    found.push({ file, line, local, name, module });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      add(node, node.expression.text, node.name.text);
    } else if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression)) {
      const key = node.argumentExpression;
      add(node, node.expression.text, ts.isStringLiteralLike(key) ? key.text : null);
    } else if (
      ts.isIdentifier(node) &&
      bindings.has(node.text) &&
      !ts.isImportSpecifier(node.parent) &&
      !ts.isImportClause(node.parent) &&
      !(ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node) &&
      !(ts.isElementAccessExpression(node.parent) && node.parent.expression === node) &&
      !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
    ) {
      add(node, node.text, null);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

// `files` maps a path relative to the console root to its text.
export function violations(files: Map<string, string>): string[] {
  const trees = new Map<string, ts.SourceFile>();
  for (const [file, text] of files) {
    if (
      /\.[cm]?tsx?$/u.test(file) &&
      !/\.test\.[cm]?tsx?$/u.test(file) &&
      !file.endsWith('.d.ts')
    ) {
      trees.set(file, treeOf(file, text));
    }
  }
  const named = reexports(trees);
  const defined = new Map<string, Map<string, number>>();
  for (const [file, text] of files) {
    if (file.endsWith('.module.css')) defined.set(file, classesOf(text));
  }
  const found: string[] = [];
  const used = new Map<string, Set<string>>();
  for (const [file, text] of files) {
    if (!file.endsWith('.module.css')) continue;
    for (const { module, name } of composedBy(file, text)) {
      used.set(module, (used.get(module) ?? new Set()).add(name));
    }
  }
  for (const [file, tree] of trees) {
    for (const reference of referencesIn(file, tree, bindingsOf(file, tree, named))) {
      const place = `${file}:${String(reference.line)}`;
      const classes = defined.get(reference.module);
      if (reference.name === null) {
        found.push(`${place}: ${reference.local} is looked up by a computed key or used whole`);
      } else if (classes?.has(reference.name) !== true) {
        found.push(
          `${place}: ${reference.local}.${reference.name} is not a class in ${reference.module}`,
        );
      } else {
        used.set(reference.module, (used.get(reference.module) ?? new Set()).add(reference.name));
      }
    }
  }
  for (const [module, classes] of defined) {
    for (const [name, line] of classes) {
      if (used.get(module)?.has(name) !== true) {
        found.push(`${module}:${String(line)}: .${name} is defined and no source file uses it`);
      }
    }
  }
  return found.sort(byPlace);
}

async function read(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for await (const file of glob('src/**/*.{css,ts,tsx,mts,cts}', {
    cwd: path.join(REPO_ROOT, root),
  })) {
    const posix = file.split(path.sep).join('/');
    files.set(posix, await readFile(path.join(REPO_ROOT, root, file), 'utf8'));
  }
  return files;
}

describe('console CSS modules', { timeout: 60_000 }, () => {
  it('define every class that is used, and use every class they define', async () => {
    const files = await read(CONSOLE);
    const names = [...files.keys()];
    expect(names.filter((file) => file.endsWith('.module.css')).length).toBeGreaterThan(50);
    expect(names).toContain('src/shared/ui/RecordTab/index.ts');
    expect(violations(files)).toEqual([]);
  });

  it('hold in the docs app too', async () => {
    const files = await read(DOCS);
    const names = [...files.keys()];
    expect(names.filter((file) => file.endsWith('.module.css')).length).toBeGreaterThan(10);
    expect(violations(files)).toEqual([]);
  });

  it('pass every conforming fixture', async () => {
    const files = await read(`${FIXTURES}/pass`);
    expect(files.size).toBeGreaterThan(3);
    expect(violations(files)).toEqual([]);
  });

  it('fail every non-conforming fixture, naming the file and the line', async () => {
    const files = await read(`${FIXTURES}/fail`);
    expect(files.size).toBeGreaterThan(2);
    expect(violations(files)).toEqual([
      'src/features/clients/ui/Sessions.tsx:4: recordTab.rule is not a class in src/shared/ui/RecordTab/RecordTab.module.css',
      'src/shared/ui/Card/Card.module.css:9: .unused is defined and no source file uses it',
      'src/shared/ui/Card/Card.tsx:7: styles.action is not a class in src/shared/ui/Card/Card.module.css',
      'src/shared/ui/Card/Card.tsx:8: styles.separator is not a class in src/shared/ui/Card/Card.module.css',
      'src/shared/ui/Card/Card.tsx:9: styles is looked up by a computed key or used whole',
      'src/shared/ui/Card/Card.tsx:14: styles is looked up by a computed key or used whole',
    ]);
  });
});
