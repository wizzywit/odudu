import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { emailOutbox, mailContext, outboxRepository, renderResetPassword } from '@odudu/email';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createMailLook } from '#/mail-look';

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  app = createDatabase(await createAppRole(container.adminUrl), { max: 5 });
}, 120_000);

afterAll(async () => {
  await app.close();
  await owner.close();
  await container.stop();
});

describe('a mail queued when the overrides cannot be read', () => {
  it('is still written in the same transaction, in the shipped wording, and the failure is logged', async () => {
    const id = newId();
    const name = `look-${id}`;
    await owner.db.insert(tenants).values({ id, name });
    // The statement fails inside the transaction: the role may no longer read the table.
    await owner.sql`revoke select on message_overrides from odudu_app`;
    try {
      const log = vi.fn();
      const look = createMailLook({ theme: () => Promise.resolve(null), log });
      await withTenant(app.db, id, async (tx) => {
        const context = await mailContext(tx, look, { tenantId: id, tenantName: name });
        expect(context.overrides).toEqual({});
        // The transaction is not aborted: the next statements run and the mail is written.
        const [row] = await tx.select({ n: tenants.name }).from(tenants).where(eq(tenants.id, id));
        expect(row?.n).toBe(name);
        await outboxRepository(tx).enqueue({
          tenantId: id,
          ...renderResetPassword({
            to: 'ada@example.test',
            link: 'https://id.example/x',
            tenantDisplayName: 'Acme',
            now: new Date('2026-10-29T00:00:00Z'),
            ...context,
          }),
        });
      });
      expect(log).toHaveBeenCalledOnce();
      expect(log.mock.calls[0]?.[0]).toMatchObject({ tenantId: id, what: 'wording' });
      const rows = await owner.db.select().from(emailOutbox).where(eq(emailOutbox.tenantId, id));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.subject).toBe('Reset your Acme password');
    } finally {
      await owner.sql`grant select on message_overrides to odudu_app`;
    }
  });
});
