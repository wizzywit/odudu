import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { expectCrossTenantMethodProbe } from '@odudu/db/testing';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { usernameRepository } from '#/repository/usernames';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let app: DatabaseHandle;

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  ownerHandle = createDatabase(containerHandle.adminUrl);
  await runMigrations(ownerHandle.db, MIGRATIONS_DIR);
  const appUrl = await createAppRole(containerHandle.adminUrl);
  appHandle = createDatabase(appUrl, { max: 5 });
  app = appHandle;
}, 120_000);

afterAll(async () => {
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

interface Seeded {
  readonly subjectId: string;
  readonly username: string;
}

async function seedUser(tx: TenantScopedDatabase, tenantId: string): Promise<Seeded> {
  const subjectId = newId();
  const username = `ada-${subjectId}`;
  await tx.execute(sql`INSERT INTO tenants (id, name) VALUES (${tenantId}, ${`t-${tenantId}`})`);
  await tx.execute(
    sql`INSERT INTO subjects (id, tenant_id, type) VALUES (${subjectId}, ${tenantId}, 'user')`,
  );
  await tx.execute(
    sql`INSERT INTO users (subject_id, tenant_id, username) VALUES (${subjectId}, ${tenantId}, ${username})`,
  );
  return { subjectId, username };
}

describe('usernameRepository', () => {
  it('reads the username of a user, and null for a subject that is not one', async () => {
    const tenantId = newId();
    const service = newId();
    const { subjectId, username } = await withTenant(app.db, tenantId, async (tx) => {
      const seeded = await seedUser(tx, tenantId);
      await tx.execute(
        sql`INSERT INTO subjects (id, tenant_id, type) VALUES (${service}, ${tenantId}, 'service')`,
      );
      return seeded;
    });

    await withTenant(app.db, tenantId, async (tx) => {
      expect(await usernameRepository(tx).usernameOf(subjectId)).toBe(username);
      expect(await usernameRepository(tx).usernameOf(service)).toBeNull();
      expect(await usernameRepository(tx).usernameOf(newId())).toBeNull();
    });
  });
});

describe('usernameRepository under a foreign tenant', () => {
  it('usernameOf finds nothing', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: seedUser,
      verifySeeded: async (tx, seeded) => {
        expect(await usernameRepository(tx).usernameOf(seeded.subjectId)).toBe(seeded.username);
      },
      attempt: (tx, seeded) => usernameRepository(tx).usernameOf(seeded.subjectId),
      expectBlocked: (result) => {
        expect(result).toBeNull();
      },
    });
  });
});
