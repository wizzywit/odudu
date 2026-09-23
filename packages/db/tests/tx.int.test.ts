import { newId, OduduError } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseHandle } from '#/client';
import { MIGRATIONS_DIR, runMigrations } from '#/migrate';
import { tenants } from '#/schema/index';
import { type TenantScopedDatabase, withEachTenantExclusive, withTenant } from '#/tx';

const TENANT_A = newId();
const TENANT_B = newId();

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

  await owner.db.insert(tenants).values([
    { id: TENANT_A, name: 'alpha' },
    { id: TENANT_B, name: 'bravo' },
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

describe('withTenant', () => {
  it('sees only the bound tenant', async () => {
    const rows = await withTenant(app.db, TENANT_A, async (tx) => tx.select().from(tenants));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('alpha');
  });

  it('does not leak tenant context to the next query on a pooled connection', async () => {
    await withTenant(app.db, TENANT_A, async (tx) => tx.select().from(tenants));

    const rows = await app.db.select().from(tenants);

    expect(rows).toEqual([]);
  });

  it('sees only its own tenant across two sequential calls on the same pooled connection', async () => {
    // app.db is a max:1 pool: both calls run on the same physical backend
    // connection, one after the other. Each must see exactly its own tenant —
    // proving set_config(..., true) rebinds cleanly call to call, not just
    // that it clears at the end (test above) or starts clear (test below).
    const alphaRows = await withTenant(app.db, TENANT_A, async (tx) => tx.select().from(tenants));
    const bravoRows = await withTenant(app.db, TENANT_B, async (tx) => tx.select().from(tenants));

    expect(alphaRows.map((row) => row.name)).toEqual(['alpha']);
    expect(bravoRows.map((row) => row.name)).toEqual(['bravo']);
  });

  it('returns no rows on a connection that has never touched the tenant GUC', async () => {
    // A brand-new pool has never called set_config on its backend connection,
    // so current_setting('app.tenant_id', true) hits the missing_ok branch and
    // returns NULL directly — distinct from the "touched, then reverted to
    // ''" branch that the leak test above exercises. Both branches must
    // filter to zero rows for the policy to fail closed in every GUC state.
    const fresh = createDatabase(appUrl, { max: 1 });

    try {
      const rows = await fresh.db.select().from(tenants);
      expect(rows).toEqual([]);
    } finally {
      await fresh.close();
    }
  });

  it('cannot update another tenant', async () => {
    await withTenant(app.db, TENANT_A, async (tx) => {
      await tx.update(tenants).set({ displayName: 'hijacked' }).where(eq(tenants.id, TENANT_B));
    });

    const [bravo] = await owner.db.select().from(tenants).where(eq(tenants.id, TENANT_B));

    expect(bravo?.displayName).toBeNull();
  });

  it('rejects an empty tenant id', async () => {
    await expect(withTenant(app.db, '', () => Promise.resolve(undefined))).rejects.toThrow(
      OduduError,
    );
  });

  it('rejects a non-UUID tenant id before it ever reaches Postgres', async () => {
    await expect(
      withTenant(app.db, 'not-a-uuid', () => Promise.resolve(undefined)),
    ).rejects.toThrow(OduduError);

    // Confirms the rejection happens at the withTenant boundary, not as a
    // driver-level 22P02 surfacing coincidentally as some other error: the
    // pool is left usable afterwards.
    const rows = await app.db.select().from(tenants);
    expect(rows).toEqual([]);
  });

  it('cannot pass a tenant-scoped handle back into withTenant (type-level guard)', () => {
    // Never invoked — its only job is to fail `tsc` (packages/db/tsconfig.json
    // includes this test file) if TenantScopedDatabase regresses back to a
    // structural alias of Database. A nested withTenant call would open a
    // savepoint whose set_config(..., true) is released rather than rolled
    // back on success, silently rebinding app.tenant_id for the rest of the
    // outer transaction.
    async function nestedWithTenantMustNotCompile(tx: TenantScopedDatabase): Promise<void> {
      // @ts-expect-error — TenantScopedDatabase omits `.transaction()`, which
      // withTenant's `db` parameter requires, so this argument is not
      // assignable and nesting fails to compile.
      await withTenant(tx, TENANT_B, () => Promise.resolve(undefined));
    }

    expect(nestedWithTenantMustNotCompile).toBeTypeOf('function');
  });
});

describe('withEachTenantExclusive', () => {
  const LOCK_KEY = 917_231;

  it('binds each tenant in turn inside one transaction', async () => {
    const pass = await withEachTenantExclusive(
      app.db,
      LOCK_KEY,
      [TENANT_A, TENANT_B],
      async (tx, tenantId) => {
        const rows = await tx.select().from(tenants);
        return { tenantId, names: rows.map((row) => row.name) };
      },
    );

    if (!pass.acquired) throw new Error('expected the lock to be free');
    expect(pass.values).toEqual([
      { tenantId: TENANT_A, names: ['alpha'] },
      { tenantId: TENANT_B, names: ['bravo'] },
    ]);
  });

  // pg_try_advisory_xact_lock, not pg_advisory_lock: the session-scoped form
  // would still be held on the pooled connection afterwards, so the second
  // pass here would skip forever with nothing reporting why.
  it('skips rather than waiting while another transaction holds the key, and takes it after', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let signalHeld!: () => void;
    const acquired = new Promise<void>((resolve) => {
      signalHeld = resolve;
    });

    const holder = withEachTenantExclusive(app.db, LOCK_KEY, [TENANT_A], async () => {
      signalHeld();
      await held;
    });
    await acquired;

    // Its own pool: `app` is opened with max: 1, so a contender sharing it
    // would block waiting for the holder's connection rather than reaching
    // the lock at all.
    const second = createDatabase(appUrl, { max: 1 });
    try {
      const contender = await withEachTenantExclusive(second.db, LOCK_KEY, [TENANT_A], () =>
        Promise.resolve(undefined),
      );
      expect(contender.acquired).toBe(false);
    } finally {
      await second.close();
    }

    release();
    await holder;

    const afterwards = await withEachTenantExclusive(app.db, LOCK_KEY, [TENANT_A], () =>
      Promise.resolve(undefined),
    );
    expect(afterwards.acquired).toBe(true);
  });

  it('releases the key when the pass throws', async () => {
    await expect(
      withEachTenantExclusive(app.db, LOCK_KEY, [TENANT_A], () => {
        throw new Error('force rollback');
      }),
    ).rejects.toThrow('force rollback');

    const afterwards = await withEachTenantExclusive(app.db, LOCK_KEY, [TENANT_A], () =>
      Promise.resolve(undefined),
    );
    expect(afterwards.acquired).toBe(true);
  });

  it('rejects a non-UUID tenant id before it opens a transaction', async () => {
    await expect(
      withEachTenantExclusive(app.db, LOCK_KEY, ['not-a-uuid'], () => Promise.resolve(undefined)),
    ).rejects.toThrow(OduduError);
  });
});
