import { totpCode, totpCounter } from '@odudu/crypto';
import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { credentialRepository, subjectRepository, users } from '@odudu/domain-identity';
import { FakeClock, newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REISSUE_INTERVAL_MS } from '#/service/authenticators/recovery-reissue';
import { provisionBrowserFlow } from '#/usecase/provision-flow';
import { beginRecoveryCodes, type BeginRecoveryCodesOutcome } from '#/usecase/recovery-codes';
import { completeTotpEnrolment } from '#/usecase/totp-enrolment';

const TOTP_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const T0 = new Date(Date.UTC(2032, 0, 1, 12));
const at = (offsetMs: number): Date => new Date(T0.getTime() + offsetMs);

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let app: DatabaseHandle;

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  ownerHandle = createDatabase(containerHandle.adminUrl);
  await runMigrations(ownerHandle.db, MIGRATIONS_DIR);
  appHandle = createDatabase(await createAppRole(containerHandle.adminUrl), { max: 5 });
  app = appHandle;
}, 120_000);

afterAll(async () => {
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

interface Account {
  tenantId: string;
  subjectId: string;
}

async function seedAccount(): Promise<Account> {
  const tenantId = newId();
  const clock = new FakeClock(T0);
  const subjectId = await withTenant(app.db, tenantId, async (tx) => {
    await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
    await provisionBrowserFlow(tx, tenantId);
    const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
    await tx.insert(users).values({ subjectId: subject.id, tenantId, username: 'ada' });
    const enrolled = await completeTotpEnrolment(
      tx,
      {
        tenantId,
        subjectId: subject.id,
        secret: TOTP_SECRET,
        code: totpCode(TOTP_SECRET, totpCounter(clock.now())),
        authSessionId: newId(),
      },
      clock,
    );
    expect(enrolled).toEqual({ kind: 'enrolled' });
    return subject.id;
  });
  return { tenantId, subjectId };
}

function begin(
  account: Account,
  now: Date,
  options: { askFirst?: boolean } = {},
): Promise<BeginRecoveryCodesOutcome> {
  return withTenant(app.db, account.tenantId, (tx) =>
    beginRecoveryCodes(tx, { ...account, now, ...options }),
  );
}

async function hashes(account: Account): Promise<string[]> {
  return withTenant(app.db, account.tenantId, async (tx) =>
    (await credentialRepository(tx).listFor(account.subjectId, 'recovery-code'))
      .flatMap((row) => (row.secret.kind === 'recovery-code' ? [row.secret.hash] : []))
      .sort(),
  );
}

async function spendAll(account: Account): Promise<void> {
  await withTenant(app.db, account.tenantId, async (tx) => {
    for (const row of await credentialRepository(tx).listFor(account.subjectId, 'recovery-code')) {
      await credentialRepository(tx).spendRecoveryCode(row.id, T0);
    }
  });
}

async function auditRows(account: Account): Promise<{ action: string; outcome: string }[]> {
  return withTenant(app.db, account.tenantId, async (tx) => {
    const rows = await tx.execute<{ action: string; outcome: string; detail: unknown }>(sql`
      select action, outcome, detail from audit_events
      where tenant_id = ${account.tenantId} and action like 'recovery_codes.%' order by occurred_at, id`);
    return rows.map((row) => ({ action: row.action, outcome: row.outcome }));
  });
}

describe('bounding the re-issue of a recovery set', () => {
  it('issues the first set and a replacement an hour later', async () => {
    const account = await seedAccount();
    expect((await begin(account, T0)).kind).toBe('issued');
    const first = await hashes(account);
    expect((await begin(account, at(REISSUE_INTERVAL_MS))).kind).toBe('issued');
    expect(await hashes(account)).not.toEqual(first);
  });

  it('refuses a replacement inside the hour, names when it opens, and changes nothing', async () => {
    const account = await seedAccount();
    await begin(account, T0);
    const held = await hashes(account);

    const outcome = await begin(account, at(10 * 60_000));

    expect(outcome).toEqual({
      kind: 'too_soon',
      retryAt: at(REISSUE_INTERVAL_MS),
      retryInMinutes: 50,
    });
    expect(await hashes(account)).toEqual(held);
  });

  it('writes an audit row for the refusal beside the one for the issue', async () => {
    const account = await seedAccount();
    await begin(account, T0);
    await begin(account, at(1000));
    expect(await auditRows(account)).toEqual([
      { action: 'recovery_codes.issued', outcome: 'allowed' },
      { action: 'recovery_codes.refused', outcome: 'refused' },
    ]);
  });

  it('does not hold back a set with nothing left to spend', async () => {
    const account = await seedAccount();
    await begin(account, T0);
    await spendAll(account);
    expect((await begin(account, at(1000))).kind).toBe('issued');
  });

  it('lets two callers at the same instant through one at a time: one issues, one is refused', async () => {
    const account = await seedAccount();
    await begin(account, T0);
    const later = at(REISSUE_INTERVAL_MS);
    const outcomes = await Promise.all([begin(account, later), begin(account, later)]);
    expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual(['issued', 'too_soon']);
  });

  it('lets the first of two concurrent first issues through and refuses the other', async () => {
    const account = await seedAccount();
    const outcomes = await Promise.all([begin(account, T0), begin(account, T0)]);
    expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual(['issued', 'too_soon']);
  });

  it('is refused for a subject another tenant holds, as for one that does not exist', async () => {
    const account = await seedAccount();
    const outcome = await withTenant(app.db, newId(), (tx) =>
      beginRecoveryCodes(tx, { ...account, now: T0 }),
    );
    expect(outcome).toEqual({ kind: 'no_second_factor' });
    expect(await auditRows(account)).toEqual([]);
  });
});

describe('asking before issuing', () => {
  it('issues nothing for a person with no set, and says nothing is replaced', async () => {
    const account = await seedAccount();
    expect(await begin(account, T0, { askFirst: true })).toEqual({ kind: 'ask', replaces: false });
    expect(await hashes(account)).toEqual([]);
    expect(await auditRows(account)).toEqual([]);
  });

  it('issues nothing for a person with a set, and says it would replace it', async () => {
    const account = await seedAccount();
    await begin(account, T0);
    const held = await hashes(account);
    expect(await begin(account, at(REISSUE_INTERVAL_MS), { askFirst: true })).toEqual({
      kind: 'ask',
      replaces: true,
    });
    expect(await hashes(account)).toEqual(held);
  });

  it('refuses to ask for a replacement the bound would refuse', async () => {
    const account = await seedAccount();
    await begin(account, T0);
    expect(await begin(account, at(1000), { askFirst: true })).toEqual({
      kind: 'too_soon',
      retryAt: at(REISSUE_INTERVAL_MS),
      retryInMinutes: 60,
    });
  });
});
