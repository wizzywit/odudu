import { generateTotpSecret } from '@odudu/crypto';
import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import {
  credentialRepository,
  hashPassword,
  subjectRepository,
  userCredentials,
  users,
} from '@odudu/domain-identity';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { flowRepository } from '#/repository/flows';
import { type PendingRequest } from '#/schema/authentication-sessions';
import { type FlowStep } from '#/schema/flow';
import {
  advance,
  authenticatedSession,
  authenticatorsSatisfyFlow,
  initialChallenge,
  pendingChallenge,
  startAuthentication,
} from '#/usecase/executor';
import { provisionBrowserFlow } from '#/usecase/provision-flow';

const SILENT_LOGGER = { error: (): void => undefined };
const PASSWORD = 'correct horse battery staple';

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

const request: PendingRequest = {
  clientId: 'client-1',
  redirectUri: 'https://client.example/callback',
  scope: 'openid',
  state: null,
  nonce: null,
  codeChallenge: 'challenge-value',
  codeChallengeMethod: 'S256',
};

const PASSWORD_ONLY: FlowStep[] = [{ authenticator: 'password', requirement: 'required' }];
const PASSWORD_THEN_CODE: FlowStep[] = [
  { authenticator: 'password', requirement: 'required' },
  { authenticator: 'otp', requirement: 'required' },
];
const PASSKEY_ONLY: FlowStep[] = [{ authenticator: 'passkey', requirement: 'required' }];

interface Seeded {
  tenantId: string;
  subjectId: string;
  passwordOnly: string;
  withCode: string;
  passkeyOnly: string;
}

// A tenant on the default flow, a subject who holds a password and an
// authenticator app, and three more flows to name.
async function seed(): Promise<Seeded> {
  const tenantId = newId();
  return withTenant(app.db, tenantId, async (tx: TenantScopedDatabase) => {
    await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
    await provisionBrowserFlow(tx, tenantId);
    const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
    await tx.insert(users).values({ subjectId: subject.id, tenantId, username: 'ada' });
    await tx.insert(userCredentials).values({
      id: newId(),
      tenantId,
      subjectId: subject.id,
      type: 'password',
      secretData: { hash: await hashPassword(PASSWORD) },
    });
    await credentialRepository(tx).insert({
      tenantId,
      subjectId: subject.id,
      type: 'totp',
      secret: { kind: 'totp', secret: generateTotpSecret(), digits: 6, lastStep: 0 },
    });
    const flows = flowRepository(tx);
    return {
      tenantId,
      subjectId: subject.id,
      passwordOnly: (await flows.create(tenantId, 'password-only', PASSWORD_ONLY)).id,
      withCode: (await flows.create(tenantId, 'with-code', PASSWORD_THEN_CODE)).id,
      passkeyOnly: (await flows.create(tenantId, 'passkey-only', PASSKEY_ONLY)).id,
    };
  });
}

function start(tenantId: string, flowId?: string): Promise<string> {
  return withTenant(app.db, tenantId, async (tx) => {
    const { authSessionId } = await startAuthentication(
      tx,
      tenantId,
      flowId === undefined ? request : { ...request, flowId },
    );
    return authSessionId;
  });
}

function submitPassword(tenantId: string, authSessionId: string) {
  return withTenant(app.db, tenantId, (tx) =>
    advance(tx, authSessionId, { username: 'ada', password: PASSWORD }, undefined, {
      logger: SILENT_LOGGER,
    }),
  );
}

describe('the flow a client names', () => {
  it('gives two sessions of one tenant different step sequences', async () => {
    const s = await seed();
    const named = await submitPassword(s.tenantId, await start(s.tenantId, s.passwordOnly));
    expect(named).toEqual({
      kind: 'success',
      subjectId: s.subjectId,
      authenticators: ['password'],
    });

    const fallback = await submitPassword(s.tenantId, await start(s.tenantId));
    expect(fallback).toEqual({ kind: 'challenge', form: 'otp' });
  });

  it('asks for what the named flow asks for after the password', async () => {
    const s = await seed();
    const outcome = await submitPassword(s.tenantId, await start(s.tenantId, s.withCode));
    expect(outcome).toEqual({ kind: 'challenge', form: 'otp' });
  });

  it('renders the first challenge of the named flow before any session exists', async () => {
    const s = await seed();
    const fallback = await withTenant(app.db, s.tenantId, (tx) => initialChallenge(tx, s.tenantId));
    expect(fallback).toEqual({ kind: 'challenge', form: 'password' });
    const named = await withTenant(app.db, s.tenantId, (tx) =>
      initialChallenge(tx, s.tenantId, undefined, s.passkeyOnly),
    );
    expect(named).toMatchObject({ kind: 'failure' });
  });

  it('leaves a session on its flow when the tenant makes another flow the default', async () => {
    const s = await seed();
    const authSessionId = await start(s.tenantId, s.passwordOnly);
    await withTenant(app.db, s.tenantId, (tx) =>
      flowRepository(tx).makeDefault(s.tenantId, s.withCode),
    );

    expect(await submitPassword(s.tenantId, authSessionId)).toEqual({
      kind: 'success',
      subjectId: s.subjectId,
      authenticators: ['password'],
    });
  });

  it('judges a finished session and a reused one by the flow they ran', async () => {
    const s = await seed();
    const authSessionId = await start(s.tenantId, s.passwordOnly);
    await submitPassword(s.tenantId, authSessionId);

    const finished = await withTenant(app.db, s.tenantId, (tx) =>
      authenticatedSession(tx, authSessionId),
    );
    expect(finished).toEqual({ subjectId: s.subjectId, authenticators: ['password'] });

    const meets = (flowId: string | null) =>
      withTenant(app.db, s.tenantId, (tx) =>
        authenticatorsSatisfyFlow(tx, s.tenantId, s.subjectId, ['password'], flowId),
      );
    expect(await meets(s.passwordOnly)).toBe(true);
    expect(await meets(s.withCode)).toBe(false);
    expect(await meets(null)).toBe(false);
  });

  it('fails closed, without an error, for a flow that no longer exists', async () => {
    const s = await seed();
    const gone = newId();
    expect(
      await withTenant(app.db, s.tenantId, (tx) =>
        initialChallenge(tx, s.tenantId, undefined, gone),
      ),
    ).toMatchObject({ kind: 'failure' });

    const authSessionId = await start(s.tenantId, gone);
    expect(await submitPassword(s.tenantId, authSessionId)).toMatchObject({ kind: 'failure' });
    expect(
      await withTenant(app.db, s.tenantId, (tx) => pendingChallenge(tx, authSessionId)),
    ).toMatchObject({ kind: 'failure' });
    expect(
      await withTenant(app.db, s.tenantId, (tx) =>
        authenticatorsSatisfyFlow(tx, s.tenantId, s.subjectId, ['password'], gone),
      ),
    ).toBe(false);
  });

  it('never resolves a flow of another tenant', async () => {
    const mine = await seed();
    const theirs = await seed();
    expect(
      await withTenant(app.db, mine.tenantId, (tx) =>
        initialChallenge(tx, mine.tenantId, undefined, theirs.passwordOnly),
      ),
    ).toMatchObject({ kind: 'failure' });
  });
});
