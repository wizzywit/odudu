import { totpCode, totpCounter } from '@odudu/crypto';
import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { auditEvents } from '@odudu/domain-audit';
import { hashPassword, subjectRepository, userCredentials, users } from '@odudu/domain-identity';
import { emailOutbox } from '@odudu/email';
import { FakeClock, newId } from '@odudu/kernel';
import {
  createAppRole,
  softwareRegistrationResponse,
  startTestDatabase,
  type TestDatabase,
} from '@odudu/testkit';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authenticationSessionRepository } from '#/repository/authentication-sessions';
import { requiredActionRepository } from '#/repository/required-actions';
import { startAuthentication } from '#/usecase/executor';
import { beginPasskeyEnrolment, completePasskeyEnrolment } from '#/usecase/passkey-enrolment';
import { provisionBrowserFlow } from '#/usecase/provision-flow';
import { beginRecoveryCodes } from '#/usecase/recovery-codes';
import { completeTotpEnrolment } from '#/usecase/totp-enrolment';

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

const BASE_URL = 'http://localhost:3000';
const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const clock = new FakeClock(new Date('2032-01-01T10:00:00Z'));

interface Account {
  tenantId: string;
  subjectId: string;
}

async function account(address: { email: string | null; verified: boolean }): Promise<Account> {
  const tenantId = newId();
  const subjectId = await withTenant(app.db, tenantId, async (tx) => {
    await tx
      .insert(tenants)
      .values({ id: tenantId, name: `tenant-${tenantId}`, displayName: 'Northwind' });
    await provisionBrowserFlow(tx, tenantId);
    const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
    await tx.insert(users).values({
      subjectId: subject.id,
      tenantId,
      username: 'ada',
      email: address.email,
      emailVerified: address.verified,
    });
    await tx.insert(userCredentials).values({
      id: newId(),
      tenantId,
      subjectId: subject.id,
      type: 'password',
      secretData: { hash: await hashPassword('correct horse battery staple') },
    });
    return subject.id;
  });
  return { tenantId, subjectId };
}

const VERIFIED = { email: 'ada@example.test', verified: true };

function enrolTotp(a: Account) {
  return withTenant(app.db, a.tenantId, (tx) =>
    completeTotpEnrolment(
      tx,
      {
        ...a,
        secret: SECRET,
        code: totpCode(SECRET, totpCounter(clock.now())),
        authSessionId: newId(),
      },
      clock,
    ),
  );
}

async function enrolPasskey(a: Account) {
  return withTenant(app.db, a.tenantId, async (tx) => {
    const { authSessionId } = await startAuthentication(tx, a.tenantId, {
      clientId: 'client-1',
      redirectUri: 'https://client.example/callback',
      scope: 'openid',
      state: null,
      nonce: null,
      codeChallenge: 'challenge-value',
      codeChallengeMethod: 'S256',
    });
    await authenticationSessionRepository(tx).bindSubject(authSessionId, a.subjectId);
    const offer = await beginPasskeyEnrolment(tx, {
      ...a,
      tenantName: `tenant-${a.tenantId}`,
      publicBaseUrl: BASE_URL,
      authSessionId,
    });
    return completePasskeyEnrolment(tx, {
      ...a,
      authSessionId,
      publicBaseUrl: BASE_URL,
      now: clock.now(),
      response: softwareRegistrationResponse({
        rpId: 'localhost',
        origin: BASE_URL,
        challenge: offer.options.challenge,
      }),
    });
  });
}

function issueSet(a: Account) {
  return withTenant(app.db, a.tenantId, (tx) =>
    beginRecoveryCodes(tx, { ...a, now: new Date('2032-01-01T12:00:00Z') }),
  );
}

function mail(a: Account) {
  return owner.db.select().from(emailOutbox).where(eq(emailOutbox.tenantId, a.tenantId));
}

async function noticeOf(a: Account, action: string): Promise<unknown> {
  const rows = await owner.db
    .select()
    .from(auditEvents)
    .where(and(eq(auditEvents.tenantId, a.tenantId), eq(auditEvents.action, action)));
  expect(rows).toHaveLength(1);
  return (rows[0]?.detail as { notice?: unknown } | null)?.notice;
}

describe('an authenticator app enrolled by the subject', () => {
  it('tells a verified address once and records that it did', async () => {
    const a = await account(VERIFIED);
    expect(await enrolTotp(a)).toEqual({ kind: 'enrolled' });
    const sent = await mail(a);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.toAddress).toBe('ada@example.test');
    expect(sent[0]?.subject).toBe('An authenticator app was added to your Northwind account');
    expect(await noticeOf(a, 'otp.enrolled')).toBe('sent');
  });

  it('is allowed for an unverified address, which is told nothing', async () => {
    const a = await account({ email: 'ada@example.test', verified: false });
    expect(await enrolTotp(a)).toEqual({ kind: 'enrolled' });
    expect(await mail(a)).toEqual([]);
    expect(await noticeOf(a, 'otp.enrolled')).toBe('skipped_unverified');
  });

  it('is allowed for a subject with no address', async () => {
    const a = await account({ email: null, verified: false });
    expect(await enrolTotp(a)).toEqual({ kind: 'enrolled' });
    expect(await mail(a)).toEqual([]);
    expect(await noticeOf(a, 'otp.enrolled')).toBe('skipped_none');
  });

  it('says it was replaced, once, when a swap removes the one held', async () => {
    const a = await account(VERIFIED);
    await enrolTotp(a);
    const before = (await mail(a)).length;
    const second = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
    const outcome = await withTenant(app.db, a.tenantId, (tx) =>
      completeTotpEnrolment(
        tx,
        {
          ...a,
          secret: second,
          code: totpCode(second, totpCounter(clock.now())),
          authSessionId: newId(),
          replace: true,
        },
        clock,
      ),
    );
    expect(outcome).toEqual({ kind: 'enrolled' });
    const added = (await mail(a)).slice(before);
    expect(added.map((row) => row.subject)).toEqual([
      'An authenticator app was replaced on your Northwind account',
    ]);
  });

  it('sends nothing when the code is wrong', async () => {
    const a = await account(VERIFIED);
    const outcome = await withTenant(app.db, a.tenantId, (tx) =>
      completeTotpEnrolment(
        tx,
        { ...a, secret: SECRET, code: '000000', authSessionId: newId() },
        clock,
      ),
    );
    expect(outcome.kind).toBe('rejected');
    expect(await mail(a)).toEqual([]);
  });
});

describe('a passkey enrolled by the subject', () => {
  it('tells a verified address once and records that it did', async () => {
    const a = await account(VERIFIED);
    expect((await enrolPasskey(a)).kind).toBe('enrolled');
    const sent = await mail(a);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.subject).toBe('A passkey was added to your Northwind account');
    expect(await noticeOf(a, 'passkey.enrolled')).toBe('sent');
  });

  it('is allowed for an unverified address, which is told nothing', async () => {
    const a = await account({ email: 'ada@example.test', verified: false });
    expect((await enrolPasskey(a)).kind).toBe('enrolled');
    expect(await mail(a)).toEqual([]);
    expect(await noticeOf(a, 'passkey.enrolled')).toBe('skipped_unverified');
  });
});

describe('a new set of recovery codes', () => {
  it('tells a verified address once and records that it did', async () => {
    const a = await account(VERIFIED);
    await enrolTotp(a);
    const before = (await mail(a)).length;
    expect((await issueSet(a)).kind).toBe('issued');
    const sent = await mail(a);
    expect(sent).toHaveLength(before + 1);
    expect(sent.map((row) => row.subject)).toContain(
      'New recovery codes were saved on your Northwind account',
    );
    expect(await noticeOf(a, 'recovery_codes.issued')).toBe('sent');
  });

  it('is allowed for an unverified address, which is told nothing', async () => {
    const a = await account({ email: 'ada@example.test', verified: false });
    await enrolTotp(a);
    expect((await issueSet(a)).kind).toBe('issued');
    expect(await mail(a)).toEqual([]);
    expect(await noticeOf(a, 'recovery_codes.issued')).toBe('skipped_unverified');
  });

  it('says nothing when the set is refused', async () => {
    const a = await account(VERIFIED);
    await enrolTotp(a);
    await issueSet(a);
    await withTenant(app.db, a.tenantId, (tx) =>
      requiredActionRepository(tx).complete(a.subjectId, 'generate-recovery-codes'),
    );
    const before = (await mail(a)).length;
    expect((await issueSet(a)).kind).toBe('too_soon');
    expect(await mail(a)).toHaveLength(before);
  });
});
