import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { auditRepository } from '@odudu/domain-audit';
import {
  createBreachedPasswordCheck,
  credentialRepository,
  subjectRepository,
  users,
  verifyUserPassword,
} from '@odudu/domain-identity';
import { emailOutbox } from '@odudu/email';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requiredActionRepository } from '#/repository/required-actions';
import { provisionBrowserFlow } from '#/usecase/provision-flow';
import {
  completeUpdatePassword,
  prepareUpdatePassword,
  type UpdatePasswordOutcome,
} from '#/usecase/update-password';

// A person who holds a passkey and no password sets a first one, only where
// the caller says the sign-in verified a passkey.

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

const breachedCheck = createBreachedPasswordCheck({
  concurrencyInProcess: 8,
  fetchRange: () => Promise.reject(new Error('no remote lookup expected')),
});
const NO_REQUEST = { requestId: null, ip: null };
const FIRST = 'a first passphrase for me';

interface Account {
  tenantId: string;
  subjectId: string;
}

async function passkeyOnly(verifiedAddress = true): Promise<Account> {
  const tenantId = newId();
  const subjectId = await withTenant(app.db, tenantId, async (tx) => {
    await tx.insert(tenants).values({
      id: tenantId,
      name: `tenant-${tenantId}`,
      displayName: 'Northwind',
      passwordMinLength: 12,
      passwordHistoryDepth: 3,
    });
    await provisionBrowserFlow(tx, tenantId);
    const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
    await tx.insert(users).values({
      subjectId: subject.id,
      tenantId,
      username: 'ada',
      email: 'ada@example.test',
      emailVerified: verifiedAddress,
    });
    return subject.id;
  });
  return { tenantId, subjectId };
}

async function setFirst(
  account: Account,
  password: string,
  verifiedPasskey: boolean,
): Promise<UpdatePasswordOutcome> {
  const input = { tenantId: account.tenantId, subjectId: account.subjectId, password };
  const breachedPrepared = await prepareUpdatePassword(app.db, input, breachedCheck, NO_REQUEST);
  return withTenant(app.db, account.tenantId, (tx) =>
    completeUpdatePassword(tx, {
      ...input,
      breachedCheck,
      breachedPrepared,
      ...(verifiedPasskey ? { firstPassword: { resolveMailLook: undefined } } : {}),
    }),
  );
}

const stored = (account: Account) =>
  withTenant(app.db, account.tenantId, (tx) =>
    credentialRepository(tx).passwordFor(account.subjectId),
  );

const auditOf = (account: Account) =>
  withTenant(app.db, account.tenantId, (tx) =>
    auditRepository(tx).list({ eventType: 'credential', limit: 20 }),
  );

describe('a first password', () => {
  it('is stored for a person with none, on a sign-in that verified a passkey', async () => {
    const account = await passkeyOnly();
    await withTenant(app.db, account.tenantId, (tx) =>
      requiredActionRepository(tx).add(account.tenantId, account.subjectId, 'update-password'),
    );
    expect(await setFirst(account, FIRST, true)).toEqual({ kind: 'updated' });
    const hash = await stored(account);
    expect(hash).not.toBeNull();
    expect(await verifyUserPassword(hash ?? '', FIRST)).toBe(true);
    expect(
      await withTenant(app.db, account.tenantId, (tx) =>
        requiredActionRepository(tx).pendingFor(account.subjectId),
      ),
    ).toEqual([]);
  });

  it('is refused, and nothing stored, on a sign-in that did not verify one', async () => {
    const account = await passkeyOnly();
    await expect(setFirst(account, FIRST, false)).rejects.toThrow(/no password credential/u);
    expect(await stored(account)).toBeNull();
  });

  it('is held to the tenant policy: a weak candidate is rejected and nothing stored', async () => {
    const account = await passkeyOnly();
    const outcome = await setFirst(account, 'short', true);
    expect(outcome.kind).toBe('rejected');
    expect(await stored(account)).toBeNull();
  });

  it('writes the audit row with first_password, and none of the password', async () => {
    const account = await passkeyOnly();
    await setFirst(account, FIRST, true);
    const rows = (await auditOf(account)).filter((row) => row.action === 'password.changed');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.detail).toMatchObject({ first_password: true });
    expect(JSON.stringify(rows[0])).not.toContain(FIRST);
  });

  it('tells a verified address by mail and records it, and mails an unverified one nothing', async () => {
    const verified = await passkeyOnly(true);
    await setFirst(verified, FIRST, true);
    const sent = await owner.db
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.tenantId, verified.tenantId));
    expect(sent).toHaveLength(1);
    expect(JSON.stringify(sent[0])).toContain('ada@example.test');
    const audit = (await auditOf(verified)).find((row) => row.action === 'password.changed');
    expect(audit?.detail).toMatchObject({ notice: 'sent' });

    const unverified = await passkeyOnly(false);
    await setFirst(unverified, FIRST, true);
    expect(
      await owner.db
        .select()
        .from(emailOutbox)
        .where(eq(emailOutbox.tenantId, unverified.tenantId)),
    ).toHaveLength(0);
    const skipped = (await auditOf(unverified)).find((row) => row.action === 'password.changed');
    expect(skipped?.detail).toMatchObject({ notice: 'skipped_unverified' });
  });

  it('lets one of two writers at the same instant store a password, and tells the other', async () => {
    const account = await passkeyOnly();
    const outcomes = await Promise.all([
      setFirst(account, FIRST, true),
      setFirst(account, 'another first passphrase', true),
    ]);
    expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual(['superseded', 'updated']);
  });

  it('keeps no history of a password nobody had', async () => {
    const account = await passkeyOnly();
    await setFirst(account, FIRST, true);
    expect(
      await withTenant(app.db, account.tenantId, (tx) =>
        credentialRepository(tx).passwordHistory(account.subjectId),
      ),
    ).toEqual([]);
  });
});
