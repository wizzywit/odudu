import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { expectCrossTenantMethodProbe } from '@odudu/db/testing';
import { subjectRepository } from '@odudu/domain-identity';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sessionRepository } from '#/repository/sessions';
import { SessionEntry } from '#/service/session-entry';

const LIFESPANS = {
  ssoSessionIdleSeconds: 1800,
  ssoSessionMaxSeconds: 36_000,
  rememberMeIdleSeconds: 604_800,
  rememberMeMaxSeconds: 2_592_000,
};

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

async function seedSubject(tx: TenantScopedDatabase, tenantId: string): Promise<string> {
  await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
  return (await subjectRepository(tx).create({ tenantId, type: 'user' })).id;
}

async function open(
  tx: TenantScopedDatabase,
  tenantId: string,
  subjectId: string,
  expiresAt: Date,
): Promise<string> {
  const entry = SessionEntry.issue(newId());
  await sessionRepository(tx).create({
    id: entry.id,
    tenantId,
    subjectId,
    expiresAt,
    authenticators: ['pwd'],
    secretHash: entry.secretHash(),
  });
  return entry.id;
}

const NOW = new Date();
const AHEAD = new Date(NOW.getTime() + 3_600_000);
const BEHIND = new Date(NOW.getTime() - 3_600_000);

describe('sessionRepository.livePageBySubject', () => {
  it('lists the subject’s live sessions only, in id order', async () => {
    const tenantId = newId();
    const { subjectId, live } = await withTenant(app.db, tenantId, async (tx) => {
      const subject = await seedSubject(tx, tenantId);
      const other = await subjectRepository(tx).create({ tenantId, type: 'user' });
      const ids = [
        await open(tx, tenantId, subject, AHEAD),
        await open(tx, tenantId, subject, AHEAD),
      ];
      await open(tx, tenantId, subject, BEHIND);
      await open(tx, tenantId, other.id, AHEAD);
      return { subjectId: subject, live: ids.sort() };
    });

    const rows = await withTenant(app.db, tenantId, (tx) =>
      sessionRepository(tx).livePageBySubject(subjectId, LIFESPANS, NOW, {
        after: undefined,
        limit: 50,
      }),
    );

    expect(rows.map((row) => row.id)).toEqual(live);
    expect(rows[0]?.expiresAt).toEqual(AHEAD);
  });

  it('returns a page of at most the limit and continues after an id', async () => {
    const tenantId = newId();
    const subjectId = await withTenant(app.db, tenantId, async (tx) => {
      const subject = await seedSubject(tx, tenantId);
      for (let i = 0; i < 5; i += 1) await open(tx, tenantId, subject, AHEAD);
      return subject;
    });

    const first = await withTenant(app.db, tenantId, (tx) =>
      sessionRepository(tx).livePageBySubject(subjectId, LIFESPANS, NOW, {
        after: undefined,
        limit: 3,
      }),
    );
    const cursor = first[2]?.id;
    const rest = await withTenant(app.db, tenantId, (tx) =>
      sessionRepository(tx).livePageBySubject(subjectId, LIFESPANS, NOW, {
        after: cursor,
        limit: 3,
      }),
    );

    expect(first).toHaveLength(3);
    expect(rest).toHaveLength(2);
    expect(rest.every((row) => cursor !== undefined && row.id > cursor)).toBe(true);
  });

  it('lists nothing of another tenant’s subject', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        const subjectId = await seedSubject(tx, tenantId);
        await open(tx, tenantId, subjectId, AHEAD);
        return { subjectId };
      },
      verifySeeded: async (tx, seeded) => {
        const rows = await sessionRepository(tx).livePageBySubject(
          seeded.subjectId,
          LIFESPANS,
          NOW,
          { after: undefined, limit: 50 },
        );
        expect(rows).toHaveLength(1);
      },
      attempt: (tx, seeded) =>
        sessionRepository(tx).livePageBySubject(seeded.subjectId, LIFESPANS, NOW, {
          after: undefined,
          limit: 50,
        }),
      expectBlocked: (rows) => {
        expect(rows).toEqual([]);
      },
    });
  });
});
