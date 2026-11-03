import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import config from '../../../.dependency-cruiser.cjs';
import { MIGRATED } from './migrated.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const FEATURES = 'apps/admin-console/src/features';

function waitingSlices(): string[] {
  const rule = config.forbidden?.find(
    (candidate) => candidate.name === 'console-features-import-no-widget',
  );
  const from = rule?.from.path;
  const group = /features\/\(\?!\(\?:([^)]*)\)\//u.exec(typeof from === 'string' ? from : '');
  if (group?.[1] === undefined) throw new Error('the widget rule names no waiting slices');
  return group[1]
    .split('|')
    .filter((name) => name !== '')
    .sort();
}

describe('console-features-import-no-widget waiting list', () => {
  it('names exactly the features that are not migrated', () => {
    const present = readdirSync(path.join(REPO_ROOT, FEATURES), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => !MIGRATED.includes(`${FEATURES}/${name}`))
      .sort();
    expect(waitingSlices()).toEqual(present);
  });
});
