import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOCS_ROOT } from '#docs/tests/support/dist.ts';
import {
  fencesOf,
  importProblems,
  packages,
  REPO_ROOT,
  type Fence,
} from '#docs/tests/support/sdk-sources.ts';

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

function pageText(file: string): string {
  return readFileSync(path.join(PAGES, file), 'utf8');
}

function fences(file: string): Fence[] {
  return fencesOf(pageText(file));
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
      const problems = importProblems(fences(file), found);
      expect(problems).toEqual([]);
    },
  );

  // Statements a later edit must not reverse: each was once written the wrong way round.
  // Each is pinned inside the line (a bullet, a paragraph or a table row) it belongs to.
  const lineWith = (file: string, marker: string): string => {
    const lines = pageText(file).split('\n');
    const start = lines.findIndex((line) => line.includes(marker));
    if (start < 0) return '';
    if (!lines[start]?.startsWith('#')) return lines[start] ?? '';
    const end = lines.findIndex((line, index) => index > start && line.startsWith('#'));
    return lines.slice(start, end < 0 ? undefined : end).join('\n');
  };

  it.each(['oidc.md', 'bff.md', 'react.md', 'me-client.md', 'admin-client.md'])(
    '%s has the lines its pins look for',
    (file) => {
      expect(pageText(file).length).toBeGreaterThan(0);
    },
  );

  it.each([
    ['oidc.md', '**What `completeSignIn` checks.**', 'signature is not checked'],
    ['bff.md', '**Several instances and the lock.**', 'store with no `lock` is never asked'],
    ['bff.md', '**Refresh.**', 'Asking for `offline_access` is not needed for a refresh token'],
    ['bff.md', '| `proxyPath`', '`prefix` moves only `login`, `callback`, `logout` and `session`'],
    ['bff.md', '| `401`', 'X-Odudu-Session: ended'],
    ['react.md', '### `useBffFetch`', 'only on a marked `401`'],
    ['react.md', '### `useBffFetch`', 'X-Odudu-Session: ended'],
    ['me-client.md', 'The client the person signs in with', 'the scope `me:read` assigned'],
    ['oidc.md', '| `meAccess`', 'The client must hold that scope'],
    ['oidc.md', '`refresh` rejects with `invalid_options`', 'not the `offline_access` scope'],
    ['admin-client.md', '| `timeoutMs`', 'RequestTimeoutError'],
  ])('%s keeps a corrected statement in %s', (file, marker, statement) => {
    expect(lineWith(file, marker)).toContain(statement);
  });

  it.each([
    ['oidc.md', '**What `completeSignIn` checks.**', "ID token's signature and `nonce` are valid"],
    ['bff.md', '**Several instances and the lock.**', 'When the store has no `lock`'],
    ['react.md', '### `useBffFetch`', 'A `401` answer means the session is over'],
    [
      'oidc.md',
      '`refresh` rejects with `invalid_options`',
      'sign in with the `offline_access` scope',
    ],
  ])('%s does not say what was false in %s', (file, marker, statement) => {
    expect(lineWith(file, marker)).not.toContain(statement);
  });

  it.each(['examples/single-page-app/README.md', 'examples/web-app/README.md'])(
    '%s says the ID token signature is not checked',
    (readme) => {
      const text = readFileSync(path.join(REPO_ROOT, readme), 'utf8');
      expect(text).toContain('it does not check the signature');
      expect(text).not.toContain("ID token's signature and `nonce`");
    },
  );

  it.each(pages.map((file) => [file] as const))('%s has a title and a description', (file) => {
    const front = /^---\n([\s\S]*?)\n---\n/u.exec(pageText(file))?.[1] ?? '';
    expect(front).toMatch(/^title: .+/mu);
    expect(front).toMatch(/^description: .+/mu);
  });
});
