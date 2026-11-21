import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fromMarkdown } from 'mdast-util-from-markdown';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { DOCS_ROOT } from '#docs/tests/support/dist.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const SDKS = path.join(REPO_ROOT, 'sdks');
const PAGES = path.join(DOCS_ROOT, 'content/en/sdks');
const EXAMPLE_LINK = /github\.com\/wizzywit\/odudu\/tree\/main\/examples\/([\w-]+)/gu;

// Pages in the section that describe no single package.
const SECTION_PAGES = new Set(['index.md', 'examples.md', 'core-without-react.md']);

// The example folders each package's page must link: where the package is used.
const EXAMPLES: Record<string, string[]> = {
  oidc: ['web-app', 'single-page-app', 'machine-to-machine'],
  react: ['react-bff'],
  bff: ['react-bff'],
  next: ['next'],
  node: ['api'],
  'admin-client': ['admin'],
  'me-client': ['admin'],
  'mcp-stdio': ['mcp'],
  python: ['python'],
};

interface Pkg {
  dir: string;
  name: string;
  version: string;
  python: boolean;
}

function packages(): Pkg[] {
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

function pageText(file: string): string {
  return readFileSync(path.join(PAGES, file), 'utf8');
}

interface Fence {
  lang: string;
  meta: string;
  value: string;
}

function fences(file: string): Fence[] {
  return fromMarkdown(pageText(file).replace(/^---\n[\s\S]*?\n---\n/u, ''))
    .children.filter((node) => node.type === 'code')
    .map((node) => ({ lang: node.lang ?? '', meta: node.meta ?? '', value: node.value }));
}

// The names a TypeScript source file exports, read from its syntax.
function exportsOf(file: string): Set<string> {
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
function entryFile(pkg: Pkg, subpath: string): string {
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

function pythonExports(module: string): Set<string> {
  const relative = PYTHON_MODULES[module];
  if (relative === undefined) throw new Error(`the test does not know the module ${module}`);
  const text = readFileSync(path.join(SDKS, 'python', relative), 'utf8');
  const block = /__all__\s*=\s*\[([\s\S]*?)\]/u.exec(text)?.[1] ?? '';
  return new Set([...block.matchAll(/["']([\w]+)["']/gu)].map((match) => match[1] ?? ''));
}

const found = packages();
const pages = readdirSync(PAGES).filter((file) => file.endsWith('.md'));

describe('the SDKs section', () => {
  it('finds the packages', () => {
    expect(found.map((pkg) => pkg.dir).sort()).toEqual(Object.keys(EXAMPLES).sort());
  });

  it.each(found.map((pkg) => [pkg.dir, pkg] as const))(
    'has a page for the package in sdks/%s',
    (dir) => {
      expect(pages).toContain(`${dir}.md`);
    },
  );

  it('has no page for a package that is not there', () => {
    const stray = pages.filter(
      (file) => !SECTION_PAGES.has(file) && !found.some((pkg) => `${pkg.dir}.md` === file),
    );
    expect(stray).toEqual([]);
  });

  it('has an index that names each package with the version of its manifest', () => {
    const rows = pageText('index.md')
      .split('\n')
      .filter((line) => line.startsWith('|'));
    for (const pkg of found) {
      const row = rows.find((line) => line.includes(`\`${pkg.name}\``));
      expect(row, `${pkg.name} has a row in the index table`).toBeDefined();
      expect(row, `${pkg.name} ${pkg.version}`).toContain(`\`${pkg.version}\``);
    }
  });

  it('links each package page from the index', () => {
    const index = pageText('index.md');
    for (const pkg of found) expect(index, pkg.dir).toContain(`(./${pkg.dir}.md)`);
  });

  it.each(found.map((pkg) => [pkg.dir, pkg] as const))(
    'shows an install command that names the package on the page for %s',
    (_dir, pkg) => {
      const installs = fences(`${pkg.dir}.md`)
        .flatMap((fence) => fence.value.split('\n'))
        .filter((line) => /^(npm install|npx|pip install) /u.test(line));
      expect(installs.length).toBeGreaterThan(0);
      expect(installs.some((line) => line.includes(pkg.name))).toBe(true);
    },
  );

  it.each(found.map((pkg) => [pkg.dir] as const))(
    'links the example folders of %s, and every folder it links exists',
    (dir) => {
      const linked = [...pageText(`${dir}.md`).matchAll(EXAMPLE_LINK)].map(
        (match) => match[1] ?? '',
      );
      for (const example of EXAMPLES[dir] ?? []) expect(linked).toContain(example);
      for (const example of linked) {
        expect(existsSync(path.join(REPO_ROOT, 'examples', example, 'README.md')), example).toBe(
          true,
        );
      }
    },
  );

  it.each(pages.map((file) => [file] as const))(
    '%s runs no shell block that is not tagged runnable',
    (file) => {
      const loose = fences(file).filter(
        (fence) =>
          ['sh', 'bash', 'zsh', 'shell', 'console'].includes(fence.lang) &&
          !/^\{run(\s|\})/u.test(fence.meta),
      );
      expect(loose).toEqual([]);
    },
  );

  it.each(pages.map((file) => [file] as const))(
    '%s imports only what its package exports',
    (file) => {
      const problems: string[] = [];
      for (const fence of fences(file)) {
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
      expect(problems).toEqual([]);
    },
  );

  // Statements a later edit must not reverse: each was once written the wrong way round.
  it.each([
    ['oidc.md', /signature is not checked/u],
    ['bff.md', /store with no `lock` is never asked/u],
    ['react.md', /only on a marked `401`/u],
    ['react.md', /X-Odudu-Session: ended/u],
    ['bff.md', /X-Odudu-Session: ended/u],
    ['admin-client.md', /RequestTimeoutError/u],
  ])('%s keeps a corrected statement (%s)', (file, statement) => {
    expect(pageText(file).replace(/\s+/gu, ' ')).toMatch(statement);
  });

  it.each([
    ['oidc.md', /ID token's signature and `nonce` are valid/u],
    ['bff.md', /no `lock` and a session needs a refresh, the read answers `503`/u],
    ['react.md', /A `401` answer means the session is over/u],
  ])('%s does not say what was false (%s)', (file, statement) => {
    expect(pageText(file).replace(/\s+/gu, ' ')).not.toMatch(statement);
  });

  it.each(pages.map((file) => [file] as const))('%s has a title and a description', (file) => {
    const front = /^---\n([\s\S]*?)\n---\n/u.exec(pageText(file))?.[1] ?? '';
    expect(front).toMatch(/^title: .+/mu);
    expect(front).toMatch(/^description: .+/mu);
  });
});
