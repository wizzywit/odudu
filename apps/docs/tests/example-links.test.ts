import { existsSync, globSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const PAGES = globSync('apps/docs/content/**/*.{md,mdx}', { cwd: REPO_ROOT });
const EXAMPLE_LINK = /github\.com\/wizzywit\/odudu\/tree\/main\/(examples\/[\w-]+)/gu;

function repoPath(relative: string): string {
  return path.join(REPO_ROOT, relative);
}

describe('links from the documentation to the examples', () => {
  const linked = PAGES.flatMap((page) =>
    [...readFileSync(repoPath(page), 'utf8').matchAll(EXAMPLE_LINK)].map((match) => ({
      page,
      directory: match[1] ?? '',
    })),
  );

  it('is made by the integration guides and the SDKs pages', () => {
    expect(new Set(linked.map(({ directory }) => directory))).toEqual(
      new Set([
        'examples/web-app',
        'examples/single-page-app',
        'examples/api',
        'examples/machine-to-machine',
        'examples/react-bff',
        'examples/next',
        'examples/admin',
        'examples/python',
        'examples/mcp',
      ]),
    );
  });

  it.each([
    ['apps/docs/content/en/guides/single-page-app.md', 'examples/single-page-app'],
    ['apps/docs/content/en/guides/sign-a-user-in.md', 'examples/single-page-app'],
    ['apps/docs/content/en/guides/sign-a-user-in.md', 'examples/web-app'],
  ])('%s links %s', (page, directory) => {
    expect(linked).toContainEqual({ page, directory });
  });

  // The Python example is a set of scripts with a requirements file and a pytest file.
  const manifests = ['package.json', 'requirements.txt'];
  const tests = ['test.ts', 'test_example.py'];

  it.each(linked.map(({ page, directory }) => [page, directory] as const))(
    '%s links %s, which exists with a README, a manifest and a test',
    (_page, directory) => {
      expect(existsSync(repoPath(`${directory}/README.md`)), `${directory}/README.md`).toBe(true);
      expect(
        manifests.some((name) => existsSync(repoPath(`${directory}/${name}`))),
        `${directory} manifest`,
      ).toBe(true);
      expect(
        tests.some((name) => existsSync(repoPath(`${directory}/${name}`))),
        `${directory} test`,
      ).toBe(true);
    },
  );
});

describe('links between the examples', () => {
  const readmes = globSync('examples/**/README.md', {
    cwd: REPO_ROOT,
    exclude: (name) => name === 'node_modules',
  });

  it('finds the READMEs', () => {
    expect(readmes.length).toBeGreaterThanOrEqual(4);
  });

  // What this file reads must be among the inputs that decide whether its
  // cached result is still good.
  const declared = (() => {
    const turbo = JSON.parse(readFileSync(repoPath('turbo.json'), 'utf8')) as {
      tasks: Record<string, { inputs?: string[] }>;
    };
    return (turbo.tasks['@odudu/docs#test']?.inputs ?? [])
      .filter((input) => input.startsWith('$TURBO_ROOT$/examples/'))
      .map((input) => input.slice('$TURBO_ROOT$/'.length));
  })();
  const isDeclared = (file: string): boolean =>
    declared.some((glob) => path.matchesGlob(file, glob));

  it.each(readmes)('%s and every file it links to are inputs of the docs test', (readme) => {
    expect(isDeclared(readme), readme).toBe(true);
    const text = readFileSync(repoPath(readme), 'utf8');
    for (const [, target] of text.matchAll(/\]\((\.{1,2}\/[^)#\s]*)\)/gu)) {
      const resolved = path.relative(
        REPO_ROOT,
        path.resolve(path.dirname(repoPath(readme)), target ?? ''),
      );
      const file = existsSync(path.join(repoPath(resolved), 'README.md'))
        ? `${resolved}/README.md`
        : resolved;
      expect(isDeclared(file), `${readme} links ${target ?? ''}`).toBe(true);
    }
  });

  it.each(readmes)('%s links only to files and folders that exist', (readme) => {
    const text = readFileSync(repoPath(readme), 'utf8');
    const relative = [...text.matchAll(/\]\((\.{1,2}\/[^)#\s]*)\)/gu)].map((m) => m[1] ?? '');
    for (const target of relative) {
      expect(existsSync(path.resolve(path.dirname(repoPath(readme)), target)), target).toBe(true);
    }
  });
});
