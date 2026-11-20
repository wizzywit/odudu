import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('what the package publishes', () => {
  it('ships dist only, built from the index that re-exports the generated types', () => {
    const manifest = JSON.parse(read('../package.json')) as { files: string[]; name: string };
    expect(manifest.name).toBe('@odudu-io/admin-client');
    expect(manifest.files).toEqual(['dist', 'LICENSE', 'CHANGELOG.md']);
    expect(read('../tsup.config.ts')).toContain("entry: ['src/index.ts']");
    expect(read('./index.ts')).toContain("from '#/generated/schema'");
  });

  it('exposes the root only and has no runtime dependency', () => {
    const manifest = JSON.parse(read('../package.json')) as {
      exports: Record<string, { types: string; default: string }>;
      dependencies?: Record<string, string>;
    };
    expect(manifest.exports).toEqual({
      '.': { types: './dist/index.d.ts', default: './dist/index.js' },
    });
    expect(manifest.dependencies).toBeUndefined();
  });
});
