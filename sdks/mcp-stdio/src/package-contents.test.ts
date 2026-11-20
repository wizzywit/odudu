import { globSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');
const manifest = JSON.parse(read('../package.json')) as {
  files: string[];
  exports: Record<string, { types: string; default: string }>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  license: string;
};

describe('what the package publishes', () => {
  it('ships dist only, built from entries that never reach the test helpers', () => {
    expect(manifest.files).toEqual(['dist', 'LICENSE', 'CHANGELOG.md']);
    const config = read('../tsup.config.ts');
    for (const [name, source] of Object.entries({ index: 'index', shared: 'shared' })) {
      expect(config).toContain(`${name}: 'src/${source}.ts'`);
    }
    for (const entry of ['index', 'shared']) {
      expect(read(`./${entry}.ts`)).not.toContain('testing');
    }
  });

  it('exposes the root and the shared subpath, each with its types', () => {
    expect(Object.keys(manifest.exports)).toEqual(['.', './shared']);
    for (const [subpath, target] of Object.entries(manifest.exports)) {
      const file = subpath === '.' ? 'index' : subpath.slice(2);
      expect(target).toEqual({ types: `./dist/${file}.d.ts`, default: `./dist/${file}.js` });
    }
  });

  it('is Apache-2.0 and depends on the MCP SDK and Zod alone', () => {
    expect(manifest.license).toBe('Apache-2.0');
    expect(Object.keys(manifest.dependencies).sort()).toEqual([
      '@modelcontextprotocol/server',
      'zod',
    ]);
  });

  it('pins the same versions as the server package it was split from', () => {
    const server = JSON.parse(read('../../../packages/mcp/package.json')) as {
      dependencies: Record<string, string>;
    };
    for (const name of Object.keys(manifest.dependencies)) {
      expect(manifest.dependencies[name]).toBe(server.dependencies[name]);
    }
  });
});

describe('what the package imports', () => {
  it('names no @odudu package, in a source file or a test', () => {
    const files = globSync('**/*.ts', { cwd: new URL('.', import.meta.url) });
    expect(files.length).toBeGreaterThan(40);
    const scope = '@odudu';
    const workspace = `from '${scope}/`;
    const offenders = files.filter((file) => read(`./${file}`).includes(workspace));
    expect(offenders).toEqual([]);
  });

  it('declares every package it imports', () => {
    const declared = new Set(
      Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }),
    );
    const imported = new Set<string>();
    for (const file of globSync('**/*.ts', { cwd: new URL('.', import.meta.url) })) {
      if (file.endsWith('.test.ts') || file.startsWith('testing/')) continue;
      for (const match of read(`./${file}`).matchAll(
        /from '((?:@[\w-]+\/)?[\w-]+)(?:\/[^']*)?'/gu,
      )) {
        const name = match[1];
        if (name !== undefined && name !== 'node') imported.add(name);
      }
    }
    for (const name of imported) expect(declared.has(name), name).toBe(true);
  });
});
