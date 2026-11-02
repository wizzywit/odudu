import { glob, readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// A `var(--name)` with no declaration renders as nothing, silently: an undefined
// ink inherits the colour around it. A name passes when the console declares it
// (`--name:` or `@property`, a quoted style-object key, `setProperty`). A use
// with a fallback passes for an undeclared name only if a package the console
// imports sets it: its name is a string in that package's installed `dist`
// (react-aria's `--trigger-width`). A fallback name within two edits of a
// declared name is a typo. A package imported but not installed throws.

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const CONSOLE = 'apps/admin-console';
const DOCS = 'apps/docs';
const FIXTURES = 'tests/lint/fixtures/console-css-vars-defined';
const USE = /var\(\s*(--[\w-]+)\s*(,)?/gu;
const DECLARATION = /(?:^|[\s{;'"])(--[\w-]+)\s*:|@property\s+(--[\w-]+)/gu;

interface Use {
  name: string;
  line: number;
  fallback: boolean;
}

interface Found {
  declared: Set<string>;
  uses: Map<string, Use[]>;
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//gu, (comment) => comment.replace(/[^\n]/gu, ' '));
}

function lineAt(text: string, offset: number): number {
  return text.slice(0, offset).split('\n').length;
}

function scanText(text: string, firstLine: number, found: Found, file: string): void {
  for (const match of text.matchAll(DECLARATION)) found.declared.add(match[1] ?? match[2] ?? '');
  for (const match of text.matchAll(USE)) {
    const uses = found.uses.get(file) ?? [];
    uses.push({
      name: match[1] ?? '',
      line: firstLine + lineAt(text, match.index) - 1,
      fallback: match[2] !== undefined,
    });
    found.uses.set(file, uses);
  }
}

function scanScript(file: string, source: string, found: Found): void {
  const tree = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const visit = (node: ts.Node): void => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      const first = tree.getLineAndCharacterOfPosition(node.getStart()).line + 1;
      scanText(node.text, first, found, file);
      if (
        ts.isStringLiteral(node) &&
        node.text.startsWith('--') &&
        ((ts.isPropertyAssignment(node.parent) && node.parent.name === node) ||
          (ts.isCallExpression(node.parent) &&
            ts.isPropertyAccessExpression(node.parent.expression) &&
            node.parent.expression.name.text === 'setProperty' &&
            node.parent.arguments[0] === node))
      ) {
        found.declared.add(node.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, at) => at);
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= b.length; column += 1) {
      const swap = a[row - 1] === b[column - 1] ? 0 : 1;
      current.push(
        Math.min(
          (previous[column] ?? 0) + 1,
          (current[column - 1] ?? 0) + 1,
          (previous[column - 1] ?? 0) + swap,
        ),
      );
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
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

// `files` maps a path relative to the console root to its text; `vendor` is
// every custom property name found in the packages the console imports.
export function violations(files: Map<string, string>, vendor: ReadonlySet<string>): string[] {
  const found: Found = { declared: new Set(), uses: new Map() };
  for (const [file, text] of files) {
    if (/\.s?css$/u.test(file)) scanText(stripComments(text), 1, found, file);
    else if (
      /\.[cm]?tsx?$/u.test(file) &&
      !/\.test\.[cm]?tsx?$/u.test(file) &&
      !file.endsWith('.d.ts')
    ) {
      scanScript(file, text, found);
    }
  }
  return [...found.uses]
    .flatMap(([file, uses]) =>
      uses.flatMap((use) => {
        const place = `${file}:${String(use.line)}: var(${use.name})`;
        if (found.declared.has(use.name)) return [];
        if (!use.fallback) {
          return `${place} is declared nowhere in the console; declare it, set it in a style object, or give the use a fallback`;
        }
        const near = [...found.declared].find((name) => editDistance(name, use.name) <= 2);
        if (near !== undefined) return `${place} is a typo of ${near}, which the console declares`;
        return vendor.has(use.name)
          ? []
          : `${place} falls back, but nothing declares ${use.name} and no package the console imports sets it`;
      }),
    )
    .sort(byPlace);
}

// The packages a source file imports: not relative, not the `#/` alias.
export function importedPackages(files: Map<string, string>): string[] {
  const packages = new Set<string>();
  for (const [file, text] of files) {
    if (!/\.[cm]?tsx?$/u.test(file) || /\.test\.[cm]?tsx?$/u.test(file)) continue;
    const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    for (const statement of tree.statements) {
      const from =
        (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
        statement.moduleSpecifier !== undefined &&
        ts.isStringLiteral(statement.moduleSpecifier)
          ? statement.moduleSpecifier.text
          : null;
      if (
        from === null ||
        from.startsWith('.') ||
        from.startsWith('#') ||
        from.startsWith('node:')
      ) {
        continue;
      }
      const parts = from.split('/');
      packages.add(from.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? from));
    }
  }
  return [...packages].sort();
}

async function distFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await distFiles(full)));
    else if (/\.(?:[cm]?js|css)$/u.test(entry.name)) out.push(full);
  }
  return out;
}

// Every custom property name written in the installed `dist` of `packages`,
// resolved under `root`/node_modules. A package that is imported but not
// installed throws: the lint cannot tell what it sets, and must not pass.
export async function vendorProperties(
  root: string,
  packages: readonly string[],
): Promise<Set<string>> {
  const names = new Set<string>();
  for (const name of packages) {
    let installed: string;
    try {
      installed = await realpath(path.join(root, 'node_modules', name));
    } catch {
      throw new Error(`${name} is imported but not installed under ${root}/node_modules`);
    }
    const dist = path.join(installed, 'dist');
    const files = await distFiles(dist).catch(() => []);
    for (const file of files) {
      for (const match of (await readFile(file, 'utf8')).matchAll(/--[a-zA-Z][\w-]*/gu)) {
        names.add(match[0]);
      }
    }
  }
  return names;
}

async function read(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for await (const file of glob('src/**/*.{css,scss,ts,tsx,mts,cts}', {
    cwd: path.join(REPO_ROOT, root),
  })) {
    const posix = file.split(path.sep).join('/');
    files.set(posix, await readFile(path.join(REPO_ROOT, root, file), 'utf8'));
  }
  return files;
}

const FIXTURE_VENDOR: ReadonlySet<string> = new Set(['--trigger-width']);

describe('console custom properties', { timeout: 60_000 }, () => {
  it('are each declared, or set by a package the console imports', async () => {
    const files = await read(CONSOLE);
    const names = [...files.keys()];
    expect(names).toContain('src/shared/ui/tokens.css');
    expect(names.filter((file) => file.endsWith('.module.css')).length).toBeGreaterThan(50);
    const packages = importedPackages(files);
    expect(packages).toContain('react-aria-components');
    const vendor = await vendorProperties(path.join(REPO_ROOT, CONSOLE), packages);
    expect(vendor.has('--trigger-width')).toBe(true);
    expect(violations(files, vendor)).toEqual([]);
  });

  it('are each declared in the docs app, the console tokens it imports, or a package it imports', async () => {
    const files = await read(DOCS);
    // custom.css imports Instrument's tokens and fonts from the console by path.
    for (const name of ['tokens.css', 'fonts.css']) {
      const text = await readFile(path.join(REPO_ROOT, CONSOLE, 'src/shared/ui', name), 'utf8');
      files.set(`console/${name}`, text);
    }
    expect(files.has('src/css/custom.css')).toBe(true);
    expect(violations(files, new Set())).toEqual([]);
  });

  it('refuses to pass for a package that is imported and not installed', async () => {
    await expect(
      vendorProperties(path.join(REPO_ROOT, CONSOLE), ['no-such-package-installed']),
    ).rejects.toThrow('no-such-package-installed is imported but not installed');
  });

  it('pass every conforming fixture', async () => {
    const files = await read(`${FIXTURES}/pass`);
    expect(files.size).toBeGreaterThan(2);
    expect(violations(files, FIXTURE_VENDOR)).toEqual([]);
  });

  it('fail every non-conforming fixture, naming the file and the line', async () => {
    const files = await read(`${FIXTURES}/fail`);
    expect(files.size).toBeGreaterThan(2);
    expect(violations(files, FIXTURE_VENDOR)).toEqual([
      'src/features/signing-keys/ui/Keys.tsx:2: var(--type-14) is declared nowhere in the console; declare it, set it in a style object, or give the use a fallback',
      'src/features/signing-keys/ui/Keys.tsx:7: var(--edge) is declared nowhere in the console; declare it, set it in a style object, or give the use a fallback',
      'src/shared/ui/Field.module.css:2: var(--space-5) is declared nowhere in the console; declare it, set it in a style object, or give the use a fallback',
      'src/shared/ui/Field.module.css:6: var(--ink-danger) is declared nowhere in the console; declare it, set it in a style object, or give the use a fallback',
      'src/shared/ui/Field.module.css:7: var(--space-9) is declared nowhere in the console; declare it, set it in a style object, or give the use a fallback',
      'src/shared/ui/Field.module.css:11: var(--spase-2) is a typo of --space-2, which the console declares',
      'src/shared/ui/Field.module.css:12: var(--spase-2) is a typo of --space-2, which the console declares',
      'src/shared/ui/Field.module.css:13: var(--made-up) falls back, but nothing declares --made-up and no package the console imports sets it',
      'src/shared/ui/Sass.module.scss:2: var(--space-6) is declared nowhere in the console; declare it, set it in a style object, or give the use a fallback',
    ]);
  });
});
