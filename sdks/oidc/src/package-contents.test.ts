import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('what the package publishes', () => {
  it('ships dist only, built from an entry that never reaches the test helpers', () => {
    const manifest = JSON.parse(read('../package.json')) as { files: string[] };
    expect(manifest.files).toEqual(['dist', 'LICENSE', 'CHANGELOG.md', 'README.md']);
    expect(read('../tsup.config.ts')).toContain("entry: ['src/index.ts']");
    expect(read('./index.ts')).not.toContain('testing');
  });
});
