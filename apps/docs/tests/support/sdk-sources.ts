import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fromMarkdown } from 'mdast-util-from-markdown';
import ts from 'typescript';

export const REPO_ROOT = path.resolve(import.meta.dirname, '../../../..');
export const SDKS = path.join(REPO_ROOT, 'sdks');

export interface Pkg {
  dir: string;
  name: string;
  version: string;
  python: boolean;
}

export function packages(): Pkg[] {
  return readdirSync(SDKS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry): Pkg | undefined => {
      const dir = path.join(SDKS, entry.name);
      if (existsSync(path.join(dir, 'package.json'))) {
        const manifest = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
          name: string;
          version: string;
        };
        return { dir: entry.name, name: manifest.name, version: manifest.version, python: false };
      }
      if (existsSync(path.join(dir, 'pyproject.toml'))) {
        const text = readFileSync(path.join(dir, 'pyproject.toml'), 'utf8');
        const name = /^name = "([^"]+)"/mu.exec(text)?.[1];
        const version = /^version = "([^"]+)"/mu.exec(text)?.[1];
        if (name === undefined || version === undefined) throw new Error('pyproject.toml');
        return { dir: entry.name, name, version, python: true };
      }
      return undefined;
    })
    .filter((pkg) => pkg !== undefined);
}

export interface Fence {
  lang: string;
  meta: string;
  value: string;
}

// The fenced code of a Markdown page, front matter left out.
export function fencesOf(text: string): Fence[] {
  return fromMarkdown(text.replace(/^---\n[\s\S]*?\n---\n/u, ''))
    .children.filter((node) => node.type === 'code')
    .map((node) => ({ lang: node.lang ?? '', meta: node.meta ?? '', value: node.value }));
}

// The names a TypeScript source file exports, read from its syntax.
export function exportsOf(file: string): Set<string> {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest);
  const names = new Set<string>();
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (statement.exportClause === undefined || !ts.isNamedExports(statement.exportClause)) {
        throw new Error(`${file} re-exports with a star, which this test cannot follow`);
      }
      for (const element of statement.exportClause.elements) names.add(element.name.text);
      continue;
    }
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    if (!modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
      }
    } else if ('name' in statement && ts.isIdentifier(statement.name as ts.Node)) {
      names.add((statement.name as ts.Identifier).text);
    }
  }
  return names;
}

// The source file behind `@odudu-io/<name>` or one of its subpaths, from the
// entries the package's build declares.
export function entryFile(pkg: Pkg, subpath: string): string {
  const config = readFileSync(path.join(SDKS, pkg.dir, 'tsup.config.ts'), 'utf8');
  const key = subpath === '' ? 'index' : subpath;
  const named = new RegExp(`\\b${key}:\\s*'([^']+)'`, 'u').exec(config)?.[1];
  const listed = subpath === '' ? /entry:\s*\['([^']+)'\]/u.exec(config)?.[1] : undefined;
  const relative = named ?? listed;
  if (relative === undefined) throw new Error(`${pkg.name} has no entry for "${subpath}"`);
  return path.join(SDKS, pkg.dir, relative);
}

const PYTHON_MODULES: Record<string, string> = {
  odudu: 'src/odudu/__init__.py',
  'odudu.admin': 'src/odudu/admin/__init__.py',
  'odudu.me': 'src/odudu/me/__init__.py',
  'odudu.verify': 'src/odudu/verify/__init__.py',
  'odudu.verify.fastapi': 'src/odudu/verify/fastapi.py',
  'odudu.verify.flask': 'src/odudu/verify/flask.py',
  'odudu.admin.operations': 'src/odudu/_generated/admin_operations.py',
  'odudu.admin.models': 'src/odudu/_generated/admin/models/__init__.py',
  'odudu.me.operations': 'src/odudu/_generated/me_operations.py',
  'odudu.me.models': 'src/odudu/_generated/me/models/__init__.py',
};

export function pythonExports(module: string): Set<string> {
  const relative = PYTHON_MODULES[module];
  if (relative === undefined) throw new Error(`the test does not know the module ${module}`);
  const text = readFileSync(path.join(SDKS, 'python', relative), 'utf8');
  const block = /__all__\s*=\s*\[([\s\S]*?)\]/u.exec(text)?.[1] ?? '';
  return new Set([...block.matchAll(/["']([\w]+)["']/gu)].map((match) => match[1] ?? ''));
}

// What a code block imports from an SDK that the SDK does not export: each
// `import { … } from '@odudu-io/x'` of a TypeScript block, and each
// `from odudu… import …` of a Python block.
export function importProblems(blocks: readonly Fence[], found: readonly Pkg[]): string[] {
  const problems: string[] = [];
  for (const fence of blocks) {
    if (['ts', 'tsx', 'js', 'jsx'].includes(fence.lang)) {
      const imports = fence.value.matchAll(
        /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*'@odudu-io\/([\w-]+)(?:\/([\w-]+))?'/gu,
      );
      for (const [, list = '', name = '', subpath = ''] of imports) {
        const pkg = found.find((candidate) => candidate.dir === name);
        if (pkg === undefined) {
          problems.push(`@odudu-io/${name} is not a package`);
          continue;
        }
        const available = exportsOf(entryFile(pkg, subpath));
        for (const part of list.split(',')) {
          const identifier = part
            .trim()
            .replace(/^type\s+/u, '')
            .split(/\s+as\s+/u)[0];
          if (identifier !== undefined && identifier !== '' && !available.has(identifier)) {
            problems.push(`${identifier} is not exported by ${pkg.name}/${subpath}`);
          }
        }
      }
    }
    if (['python', 'py'].includes(fence.lang)) {
      const imports = fence.value.matchAll(
        /^from\s+(odudu[\w.]*)\s+import\s+(\([^)]*\)|[^\n(]+)/gmu,
      );
      for (const [, module = '', list = ''] of imports) {
        const available = pythonExports(module);
        for (const part of list.replace(/[()]/gu, '').split(',')) {
          const identifier = part.trim().split(/\s+as\s+/u)[0];
          if (identifier !== undefined && identifier !== '' && !available.has(identifier)) {
            problems.push(`${identifier} is not exported by ${module}`);
          }
        }
      }
    }
  }
  return problems;
}
