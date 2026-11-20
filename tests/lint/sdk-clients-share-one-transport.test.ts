import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The two clients are independent packages (ADR 0053): neither depends on the
// other and there is no third package between them. The transport, the error,
// the retry rule and the pagination are therefore written once and held
// identical here, so a fix to one cannot be missed in the other.
const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const SRC = (pkg: string): string => path.join(REPO_ROOT, 'sdks', pkg, 'src');

const SHARED = [
  'types.ts',
  'services/problem.ts',
  'services/retry.ts',
  'services/request.ts',
  'services/pagination.ts',
  'adapter/body.ts',
  'adapter/transport.ts',
  'adapter/middleware.ts',
  'repository/client.ts',
  'use-cases/iterate.ts',
  'testing/fake-api.ts',
];

// Written for one package only: the entry point, the factory that names the
// document's paths, and what is generated or tests that document.
const OWN = new Set([
  'index.ts',
  'use-cases/admin-client.ts',
  'use-cases/me-client.ts',
  'package-contents.test.ts',
  'client.test.ts',
  'client.check.ts',
  'paths.check.ts',
]);

async function sourceFiles(directory: string, prefix = ''): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = `${prefix}${entry.name}`;
    if (entry.isDirectory() && entry.name !== 'generated') {
      found.push(...(await sourceFiles(path.join(directory, entry.name), `${relative}/`)));
    } else if (entry.isFile()) {
      found.push(relative);
    }
  }
  return found;
}

describe('the admin and me clients', () => {
  it.each(SHARED)('hold %s byte for byte', async (file) => {
    const admin = await readFile(path.join(SRC('admin-client'), file), 'utf8');
    const me = await readFile(path.join(SRC('me-client'), file), 'utf8');
    expect(me === admin, `${file} differs between sdks/admin-client and sdks/me-client`).toBe(true);
  });

  it(
    'name every other source file as one package' + "'s own, so a new shared file is listed above",
    async () => {
      for (const pkg of ['admin-client', 'me-client']) {
        const files = (await sourceFiles(SRC(pkg))).filter(
          (file) => !file.endsWith('.test.ts') || OWN.has(file),
        );
        const unlisted = files.filter((file) => !SHARED.includes(file) && !OWN.has(file));
        expect(unlisted, `${pkg} has files in neither list`).toEqual([]);
      }
    },
  );
});
