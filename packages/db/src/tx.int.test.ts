import { newId, OduduError } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseHandle } from '#/client.js';
import { MIGRATIONS_DIR, runMigrations } from '#/migrate.js';
import { realms } from '#/schema/index.js';
import { withRealm } from '#/tx.js';

const REALM_A = newId();
const REALM_B = newId();

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);

  await owner.db.insert(realms).values([
    { id: REALM_A, name: 'alpha' },
    { id: REALM_B, name: 'bravo' },
  ]);

  const appUrl = await createAppRole(container.adminUrl);
  app = createDatabase(appUrl, { max: 1 });
});

afterAll(async () => {
  // beforeAll can throw before assignment (Docker down, image pull failure);
  // guard so afterAll fails with the real cause instead of a TypeError.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  await app?.close();
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  await owner?.close();
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  await container?.stop();
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
});
