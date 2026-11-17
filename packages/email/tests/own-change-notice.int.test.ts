import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { type MailBranding, newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emailOutbox } from '#/schema/outbox';
import { queueOwnChangeNotice } from '#/usecase/own-change-notice';

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

const NOW = new Date('2026-11-12T09:05:00Z');
const BRANDING: MailBranding = { palette: null, darkPalette: null, logo: null, darkLogo: null };

async function tenant(): Promise<string> {
  const id = newId();
  await owner.db.insert(tenants).values({ id, name: `own-${id}`, displayName: 'Northwind' });
  return id;
}

function mailOf(tenantId: string) {
  return owner.db.select().from(emailOutbox).where(eq(emailOutbox.tenantId, tenantId));
}

describe('queueOwnChangeNotice', () => {
  it('queues one mail, themed, to a verified address', async () => {
    const id = await tenant();
    const outcome = await withTenant(app.db, id, (tx) =>
      queueOwnChangeNotice(
        tx,
        {
          tenantId: id,
          address: { email: 'ada@example.test', verified: true, locale: null },
          now: NOW,
        },
        { kind: 'totp_added' },
        () => Promise.resolve({ branding: BRANDING, overrides: {} }),
      ),
    );
    expect(outcome).toBe('sent');
    const rows = await mailOf(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.toAddress).toBe('ada@example.test');
    expect(rows[0]?.subject).toBe('An authenticator app was added to your Northwind account');
    expect(rows[0]?.bodyHtml).toContain('color-scheme');
  });

  it('queues nothing for an unverified address, and says so', async () => {
    const id = await tenant();
    const outcome = await withTenant(app.db, id, (tx) =>
      queueOwnChangeNotice(
        tx,
        {
          tenantId: id,
          address: { email: 'ada@example.test', verified: false, locale: null },
          now: NOW,
        },
        { kind: 'passkey_removed' },
        undefined,
      ),
    );
    expect(outcome).toBe('skipped_unverified');
    expect(await mailOf(id)).toEqual([]);
  });

  it('queues nothing for a subject with no address', async () => {
    const id = await tenant();
    const outcome = await withTenant(app.db, id, (tx) =>
      queueOwnChangeNotice(
        tx,
        { tenantId: id, address: { email: null, verified: false, locale: null }, now: NOW },
        { kind: 'recovery_set_issued' },
        undefined,
      ),
    );
    expect(outcome).toBe('skipped_none');
    expect(await mailOf(id)).toEqual([]);
  });

  it('is undone with the transaction that queued it', async () => {
    const id = await tenant();
    await expect(
      withTenant(app.db, id, async (tx) => {
        await queueOwnChangeNotice(
          tx,
          {
            tenantId: id,
            address: { email: 'ada@example.test', verified: true, locale: null },
            now: NOW,
          },
          { kind: 'totp_added' },
          undefined,
        );
        throw new Error('rolled back');
      }),
    ).rejects.toThrow('rolled back');
    expect(await mailOf(id)).toEqual([]);
  });

  it("cannot queue a mail into another tenant's outbox", async () => {
    const mine = await tenant();
    const foreign = await tenant();
    await expect(
      withTenant(app.db, mine, (tx) =>
        queueOwnChangeNotice(
          tx,
          {
            tenantId: foreign,
            address: { email: 'ada@example.test', verified: true, locale: null },
            now: NOW,
          },
          { kind: 'totp_added' },
          undefined,
        ),
      ),
    ).rejects.toThrow();
    expect(await mailOf(foreign)).toEqual([]);
  });
});
