import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase, MIGRATIONS_DIR, runMigrations, type DatabaseHandle } from '@odudu/db';
import { breachedDatasetSize, breachedHash } from '@odudu/domain-identity';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { breachedDatasetStatus, loadBreachedPasswordFile } from '#/cli/breached-passwords';

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let workDir: string;

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  app = createDatabase(await createAppRole(container.adminUrl), { max: 2 });
  workDir = mkdtempSync(join(tmpdir(), 'breached-load-'));
}, 120_000);

afterAll(async () => {
  await app.close();
  await owner.close();
  await container.stop();
  rmSync(workDir, { recursive: true, force: true });
});

function fileOf(...lines: string[]): string {
  const path = join(workDir, `${String(Math.random()).slice(2)}.txt`);
  writeFileSync(path, lines.join('\r\n'));
  return path;
}

function hashOf(password: string): string {
  const { prefix, suffix } = breachedHash(password);
  return `${prefix}${suffix}`;
}

async function count(): Promise<number> {
  const rows = await owner.sql`select count(*)::int as n from breached_password_hashes`;
  return Number(rows[0]?.n);
}

describe('odudu breached-passwords load', () => {
  it('loads a file of hashes with counts, and a second load adds nothing', async () => {
    const before = await count();
    const path = fileOf(`${hashOf('first leaked')}:12`, `${hashOf('second leaked')}:3`, '');

    expect(await loadBreachedPasswordFile(owner, path)).toEqual({ read: 2, inserted: 2 });
    expect(await count()).toBe(before + 2);
    expect(await loadBreachedPasswordFile(owner, path)).toEqual({ read: 2, inserted: 0 });
    expect(await count()).toBe(before + 2);
  });

  it('stores the split hash and nothing else', async () => {
    const hash = hashOf('stored split');
    await loadBreachedPasswordFile(owner, fileOf(hash));
    const rows = await owner.sql`
      select prefix, suffix from breached_password_hashes where prefix = ${hash.slice(0, 5)}
    `;
    expect(rows.map((row) => `${String(row.prefix)}${String(row.suffix)}`)).toContain(hash);
  });

  it('refuses a file that is not a list of SHA-1 hashes, naming the line', async () => {
    await expect(
      loadBreachedPasswordFile(owner, fileOf(`${hashOf('good one')}:1`, 'NOT-A-HASH')),
    ).rejects.toThrow(/line 2/u);
  });

  it('refuses a connection that row-level security still binds', async () => {
    await expect(loadBreachedPasswordFile(app, fileOf(hashOf('x')))).rejects.toThrow(
      /bypasses row-level security/u,
    );
  });

  it('reports whether the dataset holds anything, and how many', async () => {
    await owner.sql`delete from breached_password_hashes`;
    expect(await breachedDatasetStatus(owner)).toEqual({ loaded: false, rows: 0, capped: false });
    await loadBreachedPasswordFile(owner, fileOf(hashOf('one'), hashOf('two')));
    expect(await breachedDatasetStatus(owner)).toEqual({ loaded: true, rows: 2, capped: false });
    expect(await breachedDatasetSize(owner.db, 1)).toEqual({ rows: 1, capped: true });
  });
});
