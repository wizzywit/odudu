import { glob } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ARCHITECTURE_SCAN_TIMEOUT, checkRule } from './rule.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const FIXTURE_ROOT = path.join(import.meta.dirname, '../fixtures/architecture/no-service-barrel');
const PATTERNS = [
  'apps/admin-console/src/**/services/index.{ts,tsx}',
  'apps/docs/src/**/services/index.{ts,tsx}',
];

export async function findBarrels(root: string): Promise<string[]> {
  const found: string[] = [];
  for (const pattern of PATTERNS) {
    for await (const file of glob(pattern, { cwd: root })) {
      found.push(file.split(path.sep).join('/'));
    }
  }
  return found.sort();
}

describe('no-service-barrel', () => {
  it('finds a barrel in the fixture, so the scan is not vacuous', async () => {
    expect(await findBarrels(FIXTURE_ROOT)).toEqual([
      'apps/admin-console/src/features/demo/services/index.ts',
    ]);
  });

  it(
    'has no services/index outside the inventory',
    async () => {
      const found = await findBarrels(REPO_ROOT);
      expect(checkRule('no-service-barrel', found).errors).toEqual([]);
    },
    ARCHITECTURE_SCAN_TIMEOUT,
  );
});
