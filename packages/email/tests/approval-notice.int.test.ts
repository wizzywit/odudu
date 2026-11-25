import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { emailOutbox } from '#/schema/outbox';
import { queueApprovalNotice, queueApprovalNoticeDecoy } from '#/usecase/approval-notice';

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let appUrl: string;

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  appUrl = await createAppRole(container.adminUrl);
  app = createDatabase(appUrl, { max: 5 });
}, 120_000);

afterAll(async () => {
  await app.close();
  await owner.close();
  await container.stop();
});

const NOW = new Date('2026-11-24T09:05:00Z');
const LINK = 'https://idp.example/tenants/demo/approval/7d0e5c6a-3b0c-4f0e-9d9a-4a8f3c1b2d10';

async function tenant(): Promise<string> {
  const id = newId();
  await owner.db.insert(tenants).values({ id, name: `appr-${id}`, displayName: 'Northwind' });
  return id;
}

// What a statement does and to which table, so a decoy that touched another
// table could not pass for the real one.
function shapeOf(query: string): string | null {
  const match = /^\s*(select|insert|update|delete)\b[\s\S]*?\b(?:from|into)\s+"?([a-z_]+)"?/iu.exec(
    query,
  );
  return match === null
    ? null
    : `${(match[1] ?? '').toLowerCase()} ${(match[2] ?? '').toLowerCase()}`;
}

function mailOf(tenantId: string) {
  return owner.db.select().from(emailOutbox).where(eq(emailOutbox.tenantId, tenantId));
}

function notice(
  tenantId: string,
  address: { email: string | null; verified: boolean },
  mailBudgetAllows?: (address: string) => boolean,
) {
  return {
    ...(mailBudgetAllows === undefined ? {} : { mailBudgetAllows }),
    tenantId,
    address: { ...address, locale: null },
    link: LINK,
    agent: 'Calendar Agent',
    now: NOW,
  };
}

describe('queueApprovalNotice', () => {
  it('queues one mail to a verified address, with the link and no token', async () => {
    const id = await tenant();
    const outcome = await withTenant(app.db, id, (tx) =>
      queueApprovalNotice(tx, notice(id, { email: 'ada@example.test', verified: true }), undefined),
    );
    expect(outcome).toBe('sent');
    const rows = await mailOf(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.toAddress).toBe('ada@example.test');
    expect(rows[0]?.bodyText).toContain(LINK);
    expect(rows[0]?.bodyText).toContain('Calendar Agent');
    expect(`${rows[0]?.bodyText ?? ''}${rows[0]?.bodyHtml ?? ''}`).not.toMatch(/token|key=/iu);
  });

  it.each([
    ['an unverified address', { email: 'ada@example.test', verified: false }],
    ['no address', { email: null, verified: false }],
  ])('queues nothing for %s and says so', async (_label, address) => {
    const id = await tenant();
    const outcome = await withTenant(app.db, id, (tx) =>
      queueApprovalNotice(tx, notice(id, address), undefined),
    );
    expect(outcome).toBe('skipped_none');
    expect(await mailOf(id)).toHaveLength(0);
  });

  it('is rolled back with its transaction', async () => {
    const id = await tenant();
    await expect(
      withTenant(app.db, id, async (tx) => {
        await queueApprovalNotice(
          tx,
          notice(id, { email: 'ada@example.test', verified: true }),
          undefined,
        );
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await mailOf(id)).toHaveLength(0);
  });
});

describe('queueApprovalNotice over the mail budget of an address', () => {
  it('queues nothing, says skipped_none and runs the statements a sent notice runs', async () => {
    const id = await tenant();
    const asked: string[] = [];
    const outcome = await withTenant(app.db, id, (tx) =>
      queueApprovalNotice(
        tx,
        notice(id, { email: 'ada@example.test', verified: true }, (address) => {
          asked.push(address);
          return false;
        }),
        undefined,
      ),
    );
    expect(outcome).toBe('skipped_none');
    expect(asked).toEqual(['ada@example.test']);
    expect(await mailOf(id)).toHaveLength(0);
  });

  it('is asked only for an address that could be mailed, and a budget that allows sends', async () => {
    const id = await tenant();
    let asked = 0;
    const counting = (): boolean => {
      asked += 1;
      return true;
    };
    await withTenant(app.db, id, (tx) =>
      queueApprovalNotice(tx, notice(id, { email: null, verified: false }, counting), undefined),
    );
    await withTenant(app.db, id, (tx) =>
      queueApprovalNotice(
        tx,
        notice(id, { email: 'ada@example.test', verified: false }, counting),
        undefined,
      ),
    );
    expect(asked).toBe(0);
    const sent = await withTenant(app.db, id, (tx) =>
      queueApprovalNotice(
        tx,
        notice(id, { email: 'ada@example.test', verified: true }, counting),
        undefined,
      ),
    );
    expect(sent).toBe('sent');
    expect(asked).toBe(1);
  });
});

describe('queueApprovalNoticeDecoy', () => {
  it('runs the statements of a sent notice, of the same kinds and tables, and queues nothing', async () => {
    const id = await tenant();
    const shapes = async (decoy: boolean): Promise<string[]> => {
      const seen: string[] = [];
      let recording = false;
      const db = createDatabase(appUrl, {
        max: 2,
        onQueryForTests: (query) => {
          if (!recording || query.includes('set_config')) return;
          const shape = shapeOf(query);
          if (shape !== null) seen.push(shape);
        },
      });
      try {
        await withTenant(db.db, id, (tx) => {
          recording = true;
          const input = notice(id, { email: 'ada@example.test', verified: true });
          return decoy
            ? queueApprovalNoticeDecoy(tx, input, undefined)
            : queueApprovalNotice(tx, input, undefined).then(() => undefined);
        });
      } finally {
        await db.close();
      }
      return seen;
    };
    const real = await shapes(false);
    const before = (await mailOf(id)).length;
    const decoy = await shapes(true);
    expect(real).toContain('insert email_outbox');
    expect(decoy).toEqual(real);
    expect((await mailOf(id)).length).toBe(before);
  });

  it('runs the same statements for an address that cannot be mailed', async () => {
    const id = await tenant();
    const shapes: string[][] = [];
    for (const address of [
      { email: 'ada@example.test', verified: true, allow: true },
      { email: null, verified: false, allow: true },
      { email: 'ada@example.test', verified: true, allow: false },
    ]) {
      const seen: string[] = [];
      let recording = false;
      const db = createDatabase(appUrl, {
        max: 2,
        onQueryForTests: (query) => {
          if (!recording || query.includes('set_config')) return;
          const shape = shapeOf(query);
          if (shape !== null) seen.push(shape);
        },
      });
      try {
        await withTenant(db.db, id, (tx) => {
          recording = true;
          return queueApprovalNotice(
            tx,
            notice(id, address, () => address.allow),
            undefined,
          );
        });
      } finally {
        await db.close();
      }
      shapes.push(seen);
    }
    expect(shapes[1]).toEqual(shapes[0]);
    expect(shapes[2]).toEqual(shapes[0]);
  });
});
