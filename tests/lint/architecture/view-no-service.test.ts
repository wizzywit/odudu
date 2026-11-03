import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanApps, segments, type ModuleReference } from './imports.ts';
import { ARCHITECTURE_SCAN_TIMEOUT, checkRule } from './rule.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const FIXTURE_ROOT = path.join(import.meta.dirname, '../fixtures/architecture/view-no-service');

function resolve(file: string, reference: ModuleReference): string {
  return reference.specifier.startsWith('.')
    ? path.posix.join(path.posix.dirname(file), reference.specifier)
    : reference.specifier;
}

const SHARED_SERVICES =
  /^(?:#\/|@site\/src\/|apps\/admin-console\/src\/)shared\/lib\/services(?:\/|$)/;
const SHARED_UI = /^apps\/(?:admin-console|docs)\/src\/shared\/ui\//;

// The design system formats with the pure helpers in shared/lib/services; a
// slice's services stay out of every view, shared/ui included (ADR 0048).
function reachesServices(file: string, reference: ModuleReference): boolean {
  const resolved = resolve(file, reference);
  if (SHARED_UI.test(file) && SHARED_SERVICES.test(resolved)) {
    return false;
  }
  return segments(resolved).includes('services');
}

export async function findViewServiceBreaches(root: string): Promise<string[]> {
  const breaches: string[] = [];
  for (const { file, references } of await scanApps(root)) {
    if (!segments(file).includes('ui') || /\.test\.tsx?$/.test(file)) continue;
    if (references.some((reference) => !reference.typeOnly && reachesServices(file, reference))) {
      breaches.push(file);
    }
  }
  return breaches;
}

describe('view-no-service', () => {
  it('flags a ui file importing a service value, not a type-only import, a test file nor shared/ui reading shared/lib/services', async () => {
    expect(await findViewServiceBreaches(FIXTURE_ROOT)).toEqual([
      'apps/admin-console/src/features/alpha/ui/Reaches.tsx',
      'apps/admin-console/src/features/alpha/ui/ReachesShared.tsx',
      'apps/admin-console/src/shared/ui/Relative.tsx',
      'apps/admin-console/src/shared/ui/Slice.tsx',
      'apps/docs/src/features/alpha/ui/Dynamic.tsx',
      'apps/docs/src/features/alpha/ui/ReachesShared.tsx',
      'apps/docs/src/shared/ui/Slice.tsx',
    ]);
  });

  it(
    'has no ui file reaching a service',
    async () => {
      const found = await findViewServiceBreaches(REPO_ROOT);
      expect(checkRule('view-no-service', found).errors).toEqual([]);
    },
    ARCHITECTURE_SCAN_TIMEOUT,
  );
});
