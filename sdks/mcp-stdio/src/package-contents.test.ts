import { globSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');
const manifest = JSON.parse(read('../package.json')) as {
  files: string[];
  exports: Record<string, string | { types: string; default: string }>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  license: string;
};

describe('what the package publishes', () => {
  it('ships dist only, built from entries that never reach the test helpers', () => {
    expect(manifest.files).toEqual(['dist', 'LICENSE', 'CHANGELOG.md']);
    const config = read('../tsup.config.ts');
    for (const [name, source] of Object.entries({ index: 'index' })) {
      expect(config).toContain(`${name}: 'src/${source}.ts'`);
    }
    for (const entry of ['index']) {
      expect(read(`./${entry}.ts`)).not.toContain('testing');
    }
  });

  it('publishes the root as built code, and the internal subpath as source that is not shipped', () => {
    expect(Object.keys(manifest.exports)).toEqual(['.', './internal']);
    expect(manifest.exports['.']).toEqual({
      types: './dist/index.d.ts',
      default: './dist/index.js',
    });
    expect(manifest.exports['./internal']).toBe('./src/internal.ts');
    expect(manifest.files).not.toContain('src');
    expect(read('../tsup.config.ts')).not.toContain('internal');
  });

  it('marks every export of the internal module, and says who it is for', () => {
    const source = read('./internal.ts');
    expect(source).toContain('For @odudu/mcp only');
    const exports = source.match(/^export /gmu) ?? [];
    const marks = source.match(/^\/\*\* @internal \*\/$/gmu) ?? [];
    expect(exports.length).toBeGreaterThan(10);
    expect(marks).toHaveLength(exports.length);
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
