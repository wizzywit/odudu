import { createDatabase, MIGRATIONS_DIR, runMigrations, type DatabaseHandle } from '@odudu/db';
import { expectCrossTenantMethodProbe } from '@odudu/db/testing';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tenantDirectory, tenantNameRepository } from '#/repository/tenants';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;

let owner: DatabaseHandle;
let app: DatabaseHandle;

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  ownerHandle = createDatabase(containerHandle.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);
  const appUrl = await createAppRole(containerHandle.adminUrl);
  appHandle = createDatabase(appUrl, { max: 5 });
  app = appHandle;
}, 120_000);

afterAll(async () => {
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

describe('tenantDirectory', () => {
  it('resolves a name to its id on the owner connection, and an unknown one to null', async () => {
    const id = crypto.randomUUID();
    await owner.db.execute(sql`INSERT INTO tenants (id, name) VALUES (${id}, 'directory-probe')`);
    expect(await tenantDirectory(owner.db).idByName('directory-probe')).toBe(id);
    expect(await tenantDirectory(owner.db).idByName('no-such-tenant')).toBeNull();
  });
});

describe('tenantNameRepository under a foreign tenant', () => {
  it('nameOf finds nothing', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        const name = `t-${tenantId}`;
        await tx.execute(sql`INSERT INTO tenants (id, name) VALUES (${tenantId}, ${name})`);
        return { tenantId, name };
      },
      verifySeeded: async (tx, seeded) => {
        expect(await tenantNameRepository(tx).nameOf(seeded.tenantId)).toBe(seeded.name);
      },
      attempt: (tx, seeded) => tenantNameRepository(tx).nameOf(seeded.tenantId),
      expectBlocked: (result) => {
        expect(result).toBeNull();
      },
    });
  });
});
