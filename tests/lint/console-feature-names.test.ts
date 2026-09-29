import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// console-feature-imports-only-index substitutes a feature's folder name into
// a regex unescaped, so a name holding a metacharacter would corrupt the rule.

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const CONSOLE_SRC = 'apps/admin-console/src';
const FIXTURES = 'tests/lint/fixtures/console-features';
const FEATURE_NAME = /^[a-z][a-z-]*$/u;

// No features/ folder is no features, not an error: the console starts with none.
async function featureFolders(src: string): Promise<string[]> {
  const features = path.join(REPO_ROOT, src, 'features');
  if (!existsSync(features)) return [];
  const entries = await readdir(features, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function misnamed(folders: string[]): string[] {
  return folders.filter((name) => !FEATURE_NAME.test(name));
}

describe("the console's feature folders", () => {
  it('are named in lowercase letters and hyphens', async () => {
    expect(existsSync(path.join(REPO_ROOT, CONSOLE_SRC, 'app/App.tsx'))).toBe(true);
    expect(misnamed(await featureFolders(CONSOLE_SRC))).toEqual([]);
  });

  it('refuse a folder name outside that pattern in the fixtures', async () => {
    const folders = await featureFolders(FIXTURES);
    expect(folders).toEqual(['clients.v2', 'registration-tokens']);
    expect(misnamed(folders)).toEqual(['clients.v2']);
  });
});
