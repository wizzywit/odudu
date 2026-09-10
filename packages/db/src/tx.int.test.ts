import { newId, OduduError } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseHandle } from '#/client.js';
import { MIGRATIONS_DIR, runMigrations } from '#/migrate.js';
import { realms } from '#/schema/index.js';
import { type RealmScopedDatabase, withRealm } from '#/tx.js';

const REALM_A = newId();
const REALM_B = newId();

// Guarded (possibly-undefined) handles for cleanup: beforeAll can throw
// before assignment (Docker down, image pull failure), and afterAll must
// still run without a TypeError obscuring the real cause.
let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;

// Non-optional bindings for the test bodies below, which only ever run
// after beforeAll has succeeded. Keeping these separate from the handles
// above means the test bodies need no `!` assertions or optional chains.
let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let appUrl: string;

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  container = containerHandle;

  ownerHandle = createDatabase(container.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);

  await owner.db.insert(realms).values([
    { id: REALM_A, name: 'alpha' },
    { id: REALM_B, name: 'bravo' },
  ]);

  appUrl = await createAppRole(container.adminUrl);
  appHandle = createDatabase(appUrl, { max: 1 });
  app = appHandle;
});

afterAll(async () => {
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

describe('withRealm', () => {
  it('sees only the bound realm', async () => {
    const rows = await withRealm(app.db, REALM_A, async (tx) => tx.select().from(realms));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('alpha');
  });

  it('does not leak realm context to the next query on a pooled connection', async () => {
    await withRealm(app.db, REALM_A, async (tx) => tx.select().from(realms));

    const rows = await app.db.select().from(realms);

    expect(rows).toEqual([]);
  });

  it('sees only its own realm across two sequential calls on the same pooled connection', async () => {
    // app.db is a max:1 pool: both calls run on the same physical backend
    // connection, one after the other. Each must see exactly its own realm —
    // proving set_config(..., true) rebinds cleanly call to call, not just
    // that it clears at the end (test above) or starts clear (test below).
    const alphaRows = await withRealm(app.db, REALM_A, async (tx) => tx.select().from(realms));
    const bravoRows = await withRealm(app.db, REALM_B, async (tx) => tx.select().from(realms));

    expect(alphaRows.map((row) => row.name)).toEqual(['alpha']);
    expect(bravoRows.map((row) => row.name)).toEqual(['bravo']);
  });

  it('returns no rows on a connection that has never touched the realm GUC', async () => {
    // A brand-new pool has never called set_config on its backend connection,
    // so current_setting('app.realm_id', true) hits the missing_ok branch and
    // returns NULL directly — distinct from the "touched, then reverted to
    // ''" branch that the leak test above exercises. Both branches must
    // filter to zero rows for the policy to fail closed in every GUC state.
    const fresh = createDatabase(appUrl, { max: 1 });

    try {
      const rows = await fresh.db.select().from(realms);
      expect(rows).toEqual([]);
    } finally {
      await fresh.close();
    }
  });

  it('cannot update another realm', async () => {
    await withRealm(app.db, REALM_A, async (tx) => {
      await tx.update(realms).set({ displayName: 'hijacked' }).where(eq(realms.id, REALM_B));
    });

    const [bravo] = await owner.db.select().from(realms).where(eq(realms.id, REALM_B));

    expect(bravo?.displayName).toBeNull();
  });

  it('rejects an empty realm id', async () => {
    await expect(withRealm(app.db, '', () => Promise.resolve(undefined))).rejects.toThrow(
      OduduError,
    );
  });

  it('cannot pass a realm-scoped handle back into withRealm (type-level guard)', () => {
    // Never invoked — its only job is to fail `tsc` (packages/db/tsconfig.json
    // includes this test file) if RealmScopedDatabase regresses back to a
    // structural alias of Database. Guards findings 1 and 2: a nested
    // withRealm call would open a savepoint whose set_config(..., true) is
    // released (not rolled back) on success, silently rebinding app.realm_id
    // for the rest of the outer transaction.
    function nestedWithRealmMustNotCompile(tx: RealmScopedDatabase): void {
      // @ts-expect-error — RealmScopedDatabase omits `.transaction()`, which
      // withRealm's `db` parameter requires, so this argument is not
      // assignable and nesting fails to compile.
      void withRealm(tx, REALM_B, () => Promise.resolve(undefined));
    }

    expect(nestedWithRealmMustNotCompile).toBeTypeOf('function');
  });
});
