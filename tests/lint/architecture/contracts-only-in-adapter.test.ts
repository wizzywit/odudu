import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanApps, segments } from './imports.ts';
import { ARCHITECTURE_SCAN_TIMEOUT, checkRule } from './rule.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const FIXTURE_ROOT = path.join(
  import.meta.dirname,
  '../fixtures/architecture/contracts-only-in-adapter',
);
const CONSOLE = 'apps/admin-console/src/';
const CONTRACTS = /^@odudu\/contracts(?:\/|$)/;
const SHARED_WIRE = /^apps\/admin-console\/src\/shared\/(?:api|lib\/services|(?:.*\/)?config)\//;

// The wire's own types appear in an adapter, which maps them, and in a
// types/ folder, which names what a slice reads. A value the contracts own
// (a limit, a schema, a rule) is also read by a slice's services, by the
// shared services and the transport, and never by a view, a use case or a
// repository. Test code and the testing/ doubles are not the app.
function breaches(file: string, hasType: boolean, hasValue: boolean): boolean {
  const folders = segments(file).slice(0, -1);
  if (folders.includes('testing')) return false;
  if (folders.includes('adapter') || folders.includes('types')) return false;
  if (hasType) return true;
  return hasValue && !folders.includes('services') && !SHARED_WIRE.test(file);
}

export async function findContractBreaches(root: string): Promise<string[]> {
  const found: string[] = [];
  for (const { file, references } of await scanApps(root)) {
    if (!file.startsWith(CONSOLE) || /\.test\.tsx?$/.test(file)) continue;
    const reached = references.filter((reference) => CONTRACTS.test(reference.specifier));
    if (reached.some((reference) => breaches(file, reference.hasType, reference.hasValue))) {
      found.push(file);
    }
  }
  return found;
}

describe('contracts-only-in-adapter', () => {
  it('flags a contracts type outside adapter/ and types/, and a value in a view, use case or repository', async () => {
    const base = `${CONSOLE}features/alpha`;
    expect(await findContractBreaches(FIXTURE_ROOT)).toEqual([
      `${base}/repository/Mixed.ts`,
      `${base}/services/mixed.ts`,
      `${base}/services/typed.ts`,
      `${base}/ui/Dynamic.tsx`,
      `${base}/ui/Inline.tsx`,
      `${base}/ui/Reexport.tsx`,
      `${base}/ui/Value.tsx`,
      `${base}/ui/adapter.ts`,
      `${base}/use-cases/useType.ts`,
      `${base}/use-cases/useValue.ts`,
      `${CONSOLE}shared/lib/typed.ts`,
    ]);
  });

  it(
    'has no contracts type outside an adapter or a types folder',
    async () => {
      const found = await findContractBreaches(REPO_ROOT);
      expect(checkRule('contracts-only-in-adapter', found).errors).toEqual([]);
    },
    ARCHITECTURE_SCAN_TIMEOUT,
  );
});
