import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { newId } from '@odudu/kernel';
import { startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authenticationExecutions } from '#/schema/execution';

// Every other suite migrates as the container's superuser, which is exempt
// from row-level security whatever FORCE says. This one migrates as a bare
// schema owner instead, because FORCE removes the owner's exemption — so a
// migration that reads or writes across tenants would see nothing, write
// nothing and raise
// nothing under the role a real deployment actually uses. This suite runs
// the migrations under that role, in a database it owns, so a backfill that
// only works for a superuser fails here.
const OWNER = 'odudu_owner';

// The last migration before the recovery-code backfill: seeding on top of it
// is exactly the state a deployment upgrading onto 0040 is in.
const BEFORE_THE_BACKFILL = 39;

let containerHandle: TestDatabase | undefined;
let adminHandle: DatabaseHandle | undefined;
let ownedHandle: DatabaseHandle | undefined;

let container: TestDatabase;
let owned: DatabaseHandle;

// Only the migrations the journal lists up to `throughIndex`.
async function migrationsThrough(throughIndex: number): Promise<string> {
  const folder = await mkdtemp(path.join(tmpdir(), 'odudu-migrations-'));
  await mkdir(path.join(folder, 'meta'), { recursive: true });
  const journal: unknown = JSON.parse(
    await readFile(path.join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8'),
  );
  if (typeof journal !== 'object' || journal === null || !('entries' in journal)) {
    throw new Error('the migration journal is not the shape this check expects');
  }
  const { entries } = journal as { entries: { idx: number; tag: string }[] };
  const kept = entries.filter((entry) => entry.idx <= throughIndex);
  if (kept.length !== throughIndex + 1) {
    throw new Error(`the journal does not list every migration up to ${String(throughIndex)}`);
  }
  for (const entry of kept) {
    await cp(path.join(MIGRATIONS_DIR, `${entry.tag}.sql`), path.join(folder, `${entry.tag}.sql`));
  }
  await writeFile(
    path.join(folder, 'meta', '_journal.json'),
    JSON.stringify({ ...journal, entries: kept }),
  );
  return folder;
}

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  container = containerHandle;

  adminHandle = createDatabase(container.adminUrl, { max: 1 });
  const admin = adminHandle;
  // CREATE ROLE and nothing else. Serving needs more than this (README.md
  // requires SUPERUSER or BYPASSRLS), but a migration must not: one that
  // depends on the exemption cannot pass here.
  await admin.sql.unsafe(`CREATE ROLE ${OWNER} LOGIN PASSWORD '${OWNER}' CREATEROLE`);
  await admin.sql.unsafe(`CREATE DATABASE ${OWNER} OWNER ${OWNER}`);
  const [role] = await admin.sql<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
    select rolsuper, rolbypassrls from pg_roles where rolname = ${OWNER}
  `;
  expect(role).toEqual({ rolsuper: false, rolbypassrls: false });

  const url = new URL(container.adminUrl);
  url.username = OWNER;
  url.password = OWNER;
  url.pathname = `/${OWNER}`;
  ownedHandle = createDatabase(url.toString(), { max: 2 });
  owned = ownedHandle;
}, 180_000);

afterAll(async () => {
  await ownedHandle?.close();
  await adminHandle?.close();
  await containerHandle?.stop();
});

describe('the recovery-code backfill, run by a schema owner that is not a superuser', () => {
  it('gives a tenant provisioned before the step existed its fourth execution', async () => {
    const tenantId = newId();

    await runMigrations(owned.db, await migrationsThrough(BEFORE_THE_BACKFILL));
    await withTenant(owned.db, tenantId, async (tx) => {
      // Raw, and named down to the two columns this schema is old enough to
      // have: `tenants`' typed view describes the head of the migration set,
      // so `tx.insert(tenants)` names every column a later migration adds
      // and cannot write to the partially-migrated database this suite is
      // about.
      await tx.execute(
        sql`insert into realms (id, name) values (${tenantId}, ${`tenant-${tenantId}`})`,
      );
      for (const [index, authenticator] of ['passkey', 'password', 'otp'].entries()) {
        await tx.insert(authenticationExecutions).values({
          id: newId(),
          tenantId,
          index,
          authenticator,
          requirement: authenticator === 'otp' ? 'conditional' : 'alternative',
        });
      }
    });

    await runMigrations(owned.db, MIGRATIONS_DIR);

    const after = await withTenant(owned.db, tenantId, (tx) =>
      tx.select().from(authenticationExecutions).orderBy(asc(authenticationExecutions.index)),
    );
    expect(after.map((row) => [row.index, row.authenticator, row.requirement])).toEqual([
      [0, 'passkey', 'alternative'],
      [1, 'password', 'alternative'],
      [2, 'otp', 'conditional'],
      [3, 'recovery-code', 'conditional'],
    ]);
  }, 180_000);

  // The exemption the backfill needs is lifted for one statement, not left
  // behind it: a table serving requests without FORCE would exempt whoever
  // owns it from every tenant boundary in the schema.
  it('leaves FORCE ROW LEVEL SECURITY on afterwards', async () => {
    const [table] = await owned.sql<{ relforcerowsecurity: boolean }[]>`
      select relforcerowsecurity from pg_class where relname = 'authentication_executions'
    `;
    expect(table?.relforcerowsecurity).toBe(true);
  });

  // Recorded here because this is the only suite holding a schema owner that
  // is not RLS-exempt, and the requirement is invisible everywhere else:
  // tenantLookupRepository.byName reads `tenants` on the owner connection with
  // no tenant context, so the owner must be SUPERUSER or BYPASSRLS or no
  // tenant resolves and every request answers "unknown tenant". README.md's
  // bootstrap says so; this is the assertion behind it.
  it('cannot resolve a tenant by name at all, which is why the owner needs BYPASSRLS', async () => {
    const tenantId = newId();
    const name = `tenant-${tenantId}`;
    await withTenant(owned.db, tenantId, (tx) => tx.insert(tenants).values({ id: tenantId, name }));

    const unscoped = await owned.db.select().from(tenants).where(eq(tenants.name, name));
    const scoped = await withTenant(owned.db, tenantId, (tx) =>
      tx.select().from(tenants).where(eq(tenants.name, name)),
    );

    expect(unscoped).toEqual([]);
    expect(scoped).toHaveLength(1);
  });
});
