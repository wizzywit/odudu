import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clients } from '#/schema/clients';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  container = containerHandle;

  ownerHandle = createDatabase(container.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);

  const appUrl = await createAppRole(container.adminUrl);
  appHandle = createDatabase(appUrl, { max: 5 });
  app = appHandle;
}, 120_000);

afterAll(async () => {
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

// domain-tenant may not depend on domain-identity, so `subjects` is written
// through raw SQL rather than an imported schema table — the same reason
// consents.int.test.ts's own insertSubject helper exists.
async function insertServiceSubject(tx: TenantScopedDatabase, tenantId: string): Promise<string> {
  const subjectId = newId();
  await tx.execute(
    sql`insert into subjects (id, tenant_id, type) values (${subjectId}, ${tenantId}, 'service')`,
  );
  return subjectId;
}

describe('deleting a service subject', () => {
  it('detaches a client instead of failing its NOT NULL on tenant_id', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, async (tx) => {
      await tx.insert(tenants).values({ id: tenantId, name: `t-${tenantId}` });
      const subjectId = await insertServiceSubject(tx, tenantId);
      await tx.insert(clients).values({
        id: newId(),
        tenantId,
        clientId: 'svc',
        name: 'Service',
        type: 'confidential',
        secretHash: 'hashed:secret',
        serviceSubjectId: subjectId,
      });

      await tx.execute(sql`delete from subjects where id = ${subjectId}`);

      const [row] = await tx.select().from(clients).where(eq(clients.clientId, 'svc'));
      expect(row?.serviceSubjectId).toBeNull();
      expect(row?.tenantId).toBe(tenantId);
    });
  });
});
