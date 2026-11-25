import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// dependency-cruiser does not follow npm packages that a package declares,
// so "only the provider adapter names a model provider package" is read here.
// It cannot see a dynamic import or a package named through a variable.

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const PROVIDER_IMPORT = /from\s+'@ai-sdk\/(?!provider(?:-utils)?')[^']+'|import\(\s*'@ai-sdk\//u;

describe('the assistant package', () => {
  it('names a model provider package only in adapter/provider.ts', () => {
    const sources = globSync('packages/assistant/src/**/*.ts', { cwd: REPO_ROOT });
    expect(sources.length).toBeGreaterThan(3);
    const offenders = sources.filter(
      (file) =>
        file !== 'packages/assistant/src/adapter/provider.ts' &&
        !file.endsWith('/provider.test.ts') &&
        PROVIDER_IMPORT.test(readFileSync(path.join(REPO_ROOT, file), 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
