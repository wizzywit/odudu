import { SessionEntry, sessionRepository } from '@odudu/authn-flows';
import { signingKeyRepository, signJwt } from '@odudu/crypto';
import { createDatabase, MIGRATIONS_DIR, runMigrations, withTenant } from '@odudu/db';
import type { DatabaseHandle, TenantScopedDatabase } from '@odudu/db';
import { auditRepository } from '@odudu/domain-audit';
import { credentialRepository, subjectRepository, userRepository } from '@odudu/domain-identity';
import { clientRepository, clientScopeRepository, consentRepository } from '@odudu/domain-tenant';
import { loadConfig, meAudienceOfIssuer, newId } from '@odudu/kernel';
import { tokenGrantRepository } from '@odudu/protocol-oidc';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '#/app';
import { seed } from '#/cli/seed';
import { createLogger } from '#/logger';
import { meWritesFor } from '#/me-deps';

// The "me" writes through the real app: real signing keys, a real database.

let container: TestDatabase;
let owner: DatabaseHandle;
let appDb: DatabaseHandle;
let app: FastifyInstance;

const KEK = Buffer.alloc(32, 7);
const BASE = 'https://id.example.com';
const HOST = 'id.example.com';

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  const appUrl = await createAppRole(container.adminUrl);
  appDb = createDatabase(appUrl, { max: 8 });
  process.env.ODUDU_DATABASE_URL = container.adminUrl;
  process.env.ODUDU_APP_DATABASE_URL = appUrl;
  process.env.ODUDU_KEK = KEK.toString('base64');
  const logger = createLogger(loadConfig({ ...process.env, ODUDU_LOG_LEVEL: 'silent' }));
  app = buildApp({
    database: appDb,
    ownerDatabase: owner,
    kek: KEK,
    logger,
    tls: true,
    publicBaseUrl: BASE,
    throttle: { limit: 100_000, windowSeconds: 60 },
  });
  await app.ready();
}, 120_000);

afterAll(async () => {
  await app.close();
  delete process.env.ODUDU_DATABASE_URL;
  delete process.env.ODUDU_APP_DATABASE_URL;
  delete process.env.ODUDU_KEK;
  await appDb.close();
  await owner.close();
  await container.stop();
});

interface World {
  readonly tenantId: string;
  readonly name: string;
  readonly issuer: string;
  readonly subjectId: string;
  readonly otherSubjectId: string;
  readonly clientDbId: string;
  // The person's live sessions, the first being the token's own, each with a
  // grant bound to it, and the other person's session with its grant.
  readonly sessionIds: string[];
  readonly grantIds: string[];
  readonly otherSessionId: string;
  readonly otherGrantId: string;
  // A grant of the person under the client that no session holds.
  readonly offlineGrantId: string;
  readonly otherOfflineGrantId: string;
  readonly totpId: string;
  readonly passwordId: string;
  readonly otherTotpId: string;
}

type Tx = TenantScopedDatabase;

async function openSession(tx: Tx, tenantId: string, subjectId: string): Promise<string> {
  const entry = SessionEntry.issue(newId());
  await sessionRepository(tx).create({
    id: entry.id,
    tenantId,
    subjectId,
    expiresAt: new Date(Date.now() + 24 * 3600_000),
    authenticators: ['pwd'],
    secretHash: entry.secretHash(),
  });
  return entry.id;
}

async function grant(
  tx: Tx,
  w: { tenantId: string; clientDbId: string },
  subjectId: string,
  sessionId?: string,
): Promise<string> {
  const id = newId();
  await tokenGrantRepository(tx).create({
    id,
    tenantId: w.tenantId,
    clientId: w.clientDbId,
    subjectId,
    scope: 'openid',
    audience: [],
    ...(sessionId === undefined ? {} : { sessionId }),
  });
  return id;
}

async function world(): Promise<World> {
  const name = `mew-${newId()}`;
  const seeded = await seed({
    tenant: name,
    clientId: 'portal',
    redirectUris: ['https://app.example/callback'],
    username: 'ada',
    password: 'correct horse battery staple 1!',
    email: 'ada@example.com',
  });
  const subjectId = seeded.userSubjectId;
  if (subjectId === undefined) throw new Error('no user');
  const { tenantId } = seeded;
  return withTenant(appDb.db, tenantId, async (tx) => {
    const other = await subjectRepository(tx).create({ tenantId, type: 'user' });
    await userRepository(tx).create({
      subjectId: other.id,
      tenantId,
      username: 'grace',
      email: 'grace@example.com',
    });
    const client = await clientRepository(tx).byClientId('portal');
    if (client === null) throw new Error('no client');
    const w = { tenantId, clientDbId: client.id };

    const credentials = credentialRepository(tx);
    const totp = (who: string, label: string) =>
      credentials.insert({
        tenantId,
        subjectId: who,
        type: 'totp',
        secret: { kind: 'totp', secret: 'JBSWY3DPEHPK3PXP-seed', digits: 6, lastStep: 0 },
        label,
      });
    await totp(subjectId, 'Phone');
    await totp(other.id, 'Grace phone');
    const own = await credentials.summariesFor(subjectId, { after: undefined, limit: 10 });
    const theirs = await credentials.summariesFor(other.id, { after: undefined, limit: 10 });

    const sessionIds = [
      await openSession(tx, tenantId, subjectId),
      await openSession(tx, tenantId, subjectId),
      await openSession(tx, tenantId, subjectId),
    ].sort();
    const grantIds: string[] = [];
    for (const sessionId of sessionIds) grantIds.push(await grant(tx, w, subjectId, sessionId));
    const otherSessionId = await openSession(tx, tenantId, other.id);

    const scopes = await clientScopeRepository(tx).allForTenant();
    const scopeIds = scopes.filter((s) => ['openid', 'profile'].includes(s.name)).map((s) => s.id);
    await consentRepository(tx).record(tenantId, subjectId, client.id, scopeIds);
    await consentRepository(tx).record(tenantId, other.id, client.id, scopeIds);

    return {
      ...w,
      name,
      issuer: `${BASE}/tenants/${name}`,
      subjectId,
      otherSubjectId: other.id,
      sessionIds,
      grantIds,
      otherSessionId,
      otherGrantId: await grant(tx, w, other.id, otherSessionId),
      offlineGrantId: await grant(tx, w, subjectId),
      otherOfflineGrantId: await grant(tx, w, other.id),
      totpId: own.find((c) => c.type === 'totp')?.id ?? '',
      passwordId: own.find((c) => c.type === 'password')?.id ?? '',
      otherTotpId: theirs.find((c) => c.type === 'totp')?.id ?? '',
    };
  });
}

async function sign(
  w: World,
  claims: Record<string, unknown> = {},
  signer: World = w,
): Promise<string> {
  const key = await withTenant(appDb.db, signer.tenantId, (tx) =>
    signingKeyRepository(tx).active(),
  );
  const iat = Math.floor(Date.now() / 1000);
  return signJwt(
    {
      iss: w.issuer,
      sub: w.subjectId,
      aud: [meAudienceOfIssuer(w.issuer)],
      client_id: 'portal',
      sid: w.sessionIds[0],
      scope: 'openid me:read me:write',
      iat,
      exp: iat + 600,
      ...claims,
    },
    { key, kek: KEK, typ: 'at+jwt' },
  );
}

type Method = 'PATCH' | 'DELETE';

async function call(w: World, method: Method, path: string, token: string | null, body?: object) {
  return app.inject({
    method,
    url: `/tenants/${w.name}/me/${path}`,
    headers: {
      host: HOST,
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
    },
    ...(body === undefined ? {} : { payload: body }),
  });
}

const read = <Result>(w: World, run: (tx: Tx) => Promise<Result>): Promise<Result> =>
  withTenant(appDb.db, w.tenantId, run);

async function sessionLive(w: World, id: string): Promise<boolean> {
  const sessions = await read(w, (tx) =>
    sessionRepository(tx).liveIdsFor(w.subjectId, new Date(), 500),
  );
  const others = await read(w, (tx) =>
    sessionRepository(tx).liveIdsFor(w.otherSubjectId, new Date(), 500),
  );
  return [...sessions, ...others].includes(id);
}

async function grantRevoked(w: World, id: string): Promise<boolean> {
  const record = await read(w, (tx) => tokenGrantRepository(tx).byId(id));
  if (record === null) throw new Error('no grant');
  return record.revokedAt !== null;
}

function auditRows(w: World, action: string) {
  return read(w, (tx) => auditRepository(tx).list({ action, limit: 50 }));
}

describe('PATCH /me/profile', () => {
  it('amends the person’s own claims and files the fields, never the values', async () => {
    const w = await world();
    const res = await call(w, 'PATCH', 'profile', await sign(w), {
      name: 'Ada Lovelace',
      birthdate: '1815-12-10',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ sub: w.subjectId, name: 'Ada Lovelace' });

    const user = await read(w, (tx) => userRepository(tx).bySubjectId(w.subjectId));
    expect(user).toMatchObject({ name: 'Ada Lovelace', birthdate: '1815-12-10' });
    const other = await read(w, (tx) => userRepository(tx).bySubjectId(w.otherSubjectId));
    expect(other?.name).toBeNull();

    const rows = await auditRows(w, 'subject.profile_amend');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      eventType: 'admin_mutation',
      outcome: 'allowed',
      actorSubjectId: w.subjectId,
      actorClientId: w.clientDbId,
      resourceType: 'subject',
      resourceId: w.subjectId,
      detail: { via: 'me', fields: ['name', 'birthdate'] },
    });
    expect(JSON.stringify(rows[0]?.detail)).not.toContain('1815');
  });

  it('drops the verification of a phone number that changes', async () => {
    const w = await world();
    await read(w, async (tx) => {
      await userRepository(tx).updateProfile(w.subjectId, { phoneNumber: '+2348012345678' });
      await userRepository(tx).setVerification(w.subjectId, { phoneNumberVerified: true });
    });
    const res = await call(w, 'PATCH', 'profile', await sign(w), {
      phone_number: '+2348099999999',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      phone_number: '+2348099999999',
      phone_number_verified: false,
    });
  });

  it('refuses the members a person does not set, and changes nothing', async () => {
    const w = await world();
    const token = await sign(w);
    for (const body of [
      { email: 'x@example.com' },
      { username: 'zed' },
      { email_verified: true },
    ]) {
      expect((await call(w, 'PATCH', 'profile', token, body)).statusCode).toBe(400);
    }
    const user = await read(w, (tx) => userRepository(tx).bySubjectId(w.subjectId));
    expect(user).toMatchObject({ username: 'ada', email: 'ada@example.com' });
    expect(await auditRows(w, 'subject.profile_amend')).toEqual([]);
  });

  it('records nothing when nothing changes', async () => {
    const w = await world();
    const res = await call(w, 'PATCH', 'profile', await sign(w), { nickname: null });
    expect(res.statusCode).toBe(200);
    expect(await auditRows(w, 'subject.profile_amend')).toEqual([]);
  });
});

describe('DELETE /me/sessions/{id}', () => {
  it('ends another session of the person, its grants and nothing else', async () => {
    const w = await world();
    const target = w.sessionIds[1] ?? '';
    const res = await call(w, 'DELETE', `sessions/${target}`, await sign(w));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ current_session_ended: false });

    expect(await sessionLive(w, target)).toBe(false);
    expect(await grantRevoked(w, w.grantIds[1] ?? '')).toBe(true);
    for (const kept of [w.sessionIds[0], w.sessionIds[2], w.otherSessionId]) {
      expect(await sessionLive(w, kept ?? '')).toBe(true);
    }
    expect(await grantRevoked(w, w.grantIds[0] ?? '')).toBe(false);
    expect(await grantRevoked(w, w.offlineGrantId)).toBe(false);

    const ended = await auditRows(w, 'session.end');
    expect(ended).toHaveLength(1);
    expect(ended[0]).toMatchObject({
      resourceType: 'session',
      resourceId: target,
      actorSubjectId: w.subjectId,
      actorClientId: w.clientDbId,
      detail: { via: 'me', current: false },
    });
    const logout = await auditRows(w, 'session.ended');
    expect(logout.map((row) => row.detail)).toEqual([{ via: 'self' }]);
  });

  it('may end the token’s own session, and says so', async () => {
    const w = await world();
    const own = w.sessionIds[0] ?? '';
    const res = await call(w, 'DELETE', `sessions/${own}`, await sign(w));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ current_session_ended: true });
    expect(await sessionLive(w, own)).toBe(false);
    expect((await auditRows(w, 'session.end'))[0]?.detail).toMatchObject({ current: true });
  });

  it('answers 404 for another person’s session and leaves it live', async () => {
    const w = await world();
    const res = await call(w, 'DELETE', `sessions/${w.otherSessionId}`, await sign(w));
    expect(res.statusCode).toBe(404);
    expect(await sessionLive(w, w.otherSessionId)).toBe(true);
    expect(await grantRevoked(w, w.otherGrantId)).toBe(false);
    expect(await auditRows(w, 'session.end')).toEqual([]);
  });

  it('answers 404 for an id that is not a session, a uuid or not', async () => {
    const w = await world();
    const token = await sign(w);
    expect((await call(w, 'DELETE', `sessions/${newId()}`, token)).statusCode).toBe(404);
    expect((await call(w, 'DELETE', 'sessions/not-an-id', token)).statusCode).toBe(404);
  });
});

describe('DELETE /me/sessions', () => {
  it('ends every other session of the person and keeps the token’s own', async () => {
    const w = await world();
    const res = await call(w, 'DELETE', 'sessions', await sign(w));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ended: 2, more: false });

    expect(await sessionLive(w, w.sessionIds[0] ?? '')).toBe(true);
    expect(await sessionLive(w, w.sessionIds[1] ?? '')).toBe(false);
    expect(await sessionLive(w, w.sessionIds[2] ?? '')).toBe(false);
    expect(await sessionLive(w, w.otherSessionId)).toBe(true);
    expect(await grantRevoked(w, w.grantIds[1] ?? '')).toBe(true);
    expect(await grantRevoked(w, w.grantIds[0] ?? '')).toBe(false);
    expect(await grantRevoked(w, w.otherGrantId)).toBe(false);

    const rows = await auditRows(w, 'session.end_all');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      resourceType: 'subject',
      resourceId: w.subjectId,
      detail: { via: 'me', ended: 2, more: false },
    });
  });

  it('ends a bounded number in one request and says more remain', async () => {
    const w = await world();
    await read(w, async (tx) => {
      for (let i = 0; i < 100; i += 1) await openSession(tx, w.tenantId, w.subjectId);
    });
    const first = await call(w, 'DELETE', 'sessions', await sign(w));
    expect(first.json()).toEqual({ ended: 100, more: true });
    const second = await call(w, 'DELETE', 'sessions', await sign(w));
    expect(second.json()).toEqual({ ended: 2, more: false });
    expect(await sessionLive(w, w.sessionIds[0] ?? '')).toBe(true);
  });

  it('with nothing else live ends nothing and records nothing', async () => {
    const w = await world();
    const token = await sign(w);
    await call(w, 'DELETE', 'sessions', token);
    const again = await call(w, 'DELETE', 'sessions', token);
    expect(again.json()).toEqual({ ended: 0, more: false });
    expect(await auditRows(w, 'session.end_all')).toHaveLength(1);
  });
});

describe('DELETE /me/consents/{client_id}', () => {
  it('withdraws the person’s consent and revokes their grants under the client', async () => {
    const w = await world();
    const res = await call(w, 'DELETE', 'consents/portal', await sign(w));
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');

    const mine = await read(w, (tx) =>
      consentRepository(tx).forSubject(w.subjectId, { after: undefined, limit: 10 }),
    );
    const theirs = await read(w, (tx) =>
      consentRepository(tx).forSubject(w.otherSubjectId, { after: undefined, limit: 10 }),
    );
    expect(mine).toEqual([]);
    expect(theirs).toHaveLength(1);
    for (const id of [...w.grantIds, w.offlineGrantId])
      expect(await grantRevoked(w, id)).toBe(true);
    for (const id of [w.otherGrantId, w.otherOfflineGrantId]) {
      expect(await grantRevoked(w, id)).toBe(false);
    }

    const rows = await auditRows(w, 'consent.revoke');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      resourceId: w.subjectId,
      actorSubjectId: w.subjectId,
      actorClientId: w.clientDbId,
      detail: { via: 'me', client_id: 'portal', grants_revoked: 4 },
    });
  });

  it('answers 404 for a second withdrawal and for a client the person never consented to', async () => {
    const w = await world();
    const token = await sign(w);
    expect((await call(w, 'DELETE', 'consents/portal', token)).statusCode).toBe(204);
    expect((await call(w, 'DELETE', 'consents/portal', token)).statusCode).toBe(404);
    expect((await call(w, 'DELETE', 'consents/no-such-client', token)).statusCode).toBe(404);
    expect(await auditRows(w, 'consent.revoke')).toHaveLength(1);
  });

  it('never reaches another person’s consent, whoever asks', async () => {
    const w = await world();
    const graceToken = await sign(w, { sub: w.otherSubjectId, sid: w.otherSessionId });
    expect((await call(w, 'DELETE', 'consents/portal', graceToken)).statusCode).toBe(204);
    const mine = await read(w, (tx) =>
      consentRepository(tx).forSubject(w.subjectId, { after: undefined, limit: 10 }),
    );
    expect(mine).toHaveLength(1);
  });
});

describe('PATCH /me/credentials/{id}', () => {
  it('relabels the person’s authenticator and files the change without the label', async () => {
    const w = await world();
    const res = await call(w, 'PATCH', `credentials/${w.totpId}`, await sign(w), {
      label: 'Work phone',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: w.totpId, type: 'totp', label: 'Work phone' });

    const rows = await read(w, (tx) =>
      credentialRepository(tx).summariesFor(w.subjectId, { after: undefined, limit: 10 }),
    );
    expect(rows.find((c) => c.id === w.totpId)?.label).toBe('Work phone');

    const audit = await auditRows(w, 'subject.credential_rename');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      resourceId: w.subjectId,
      actorSubjectId: w.subjectId,
      actorClientId: w.clientDbId,
      detail: { via: 'me', credential_id: w.totpId, type: 'totp' },
    });
    expect(JSON.stringify(audit[0]?.detail)).not.toContain('Work phone');
  });

  it('answers 404 for another person’s authenticator and a password, and changes neither', async () => {
    const w = await world();
    const token = await sign(w);
    const body = { label: 'Taken' };
    expect((await call(w, 'PATCH', `credentials/${w.otherTotpId}`, token, body)).statusCode).toBe(
      404,
    );
    expect((await call(w, 'PATCH', `credentials/${w.passwordId}`, token, body)).statusCode).toBe(
      404,
    );
    expect((await call(w, 'PATCH', 'credentials/not-an-id', token, body)).statusCode).toBe(404);
    const theirs = await read(w, (tx) =>
      credentialRepository(tx).summariesFor(w.otherSubjectId, { after: undefined, limit: 10 }),
    );
    expect(theirs.find((c) => c.id === w.otherTotpId)?.label).toBe('Grace phone');
    expect(await auditRows(w, 'subject.credential_rename')).toEqual([]);
  });

  it('refuses a label that is empty, too long or carries more than a label', async () => {
    const w = await world();
    const token = await sign(w);
    for (const body of [{ label: '' }, { label: 'x'.repeat(101) }, { label: 'a', type: 'totp' }]) {
      expect((await call(w, 'PATCH', `credentials/${w.totpId}`, token, body)).statusCode).toBe(400);
    }
  });
});

const WRITES = (w: World): [Method, string, object | undefined][] => [
  ['PATCH', 'profile', { name: 'Changed' }],
  ['DELETE', 'sessions', undefined],
  ['DELETE', `sessions/${w.sessionIds[1] ?? ''}`, undefined],
  ['DELETE', 'consents/portal', undefined],
  ['PATCH', `credentials/${w.totpId}`, { label: 'Changed' }],
];

async function untouched(w: World): Promise<void> {
  const user = await read(w, (tx) => userRepository(tx).bySubjectId(w.subjectId));
  expect(user?.name).toBeNull();
  for (const id of w.sessionIds) expect(await sessionLive(w, id)).toBe(true);
  const consents = await read(w, (tx) =>
    consentRepository(tx).forSubject(w.subjectId, { after: undefined, limit: 10 }),
  );
  expect(consents).toHaveLength(1);
  const credentials = await read(w, (tx) =>
    credentialRepository(tx).summariesFor(w.subjectId, { after: undefined, limit: 10 }),
  );
  expect(credentials.find((c) => c.id === w.totpId)?.label).toBe('Phone');
  for (const action of [
    'subject.profile_amend',
    'session.end',
    'session.end_all',
    'consent.revoke',
    'subject.credential_rename',
  ]) {
    expect(await auditRows(w, action), action).toEqual([]);
  }
}

describe('who may write', () => {
  it('refuses a token holding me:read alone, naming me:write', async () => {
    const w = await world();
    const token = await sign(w, { scope: 'openid me:read' });
    for (const [method, path, body] of WRITES(w)) {
      const res = await call(w, method, path, token, body);
      expect(res.statusCode, `${method} ${path}`).toBe(403);
      expect(res.headers['www-authenticate']).toBe(
        'Bearer error="insufficient_scope", scope="me:write"',
      );
    }
    await untouched(w);
  });

  it('refuses a token marked for an agent with agent_not_permitted, changing nothing', async () => {
    const w = await world();
    const token = await sign(w, { act: { sub: 'agent-1', client_id: 'agent' } });
    for (const [method, path, body] of WRITES(w)) {
      const res = await call(w, method, path, token, body);
      expect(res.statusCode, `${method} ${path}`).toBe(403);
      expect(res.json()).toMatchObject({ error: 'agent_not_permitted' });
    }
    await untouched(w);
  });

  it('lets a person’s token make each of the same calls', async () => {
    const w = await world();
    const token = await sign(w);
    for (const [method, path, body] of WRITES(w)) {
      const res = await call(w, method, path, token, body);
      expect(res.statusCode, `${method} ${path}`).toBeLessThan(300);
      expect(res.headers['cache-control']).toBe('no-store');
    }
  });

  it('challenges a request with no token, and refuses another tenant’s token', async () => {
    const w = await world();
    const stranger = await world();
    for (const [method, path, body] of WRITES(w)) {
      expect((await call(w, method, path, null, body)).statusCode).toBe(401);
      const foreign = await sign(w, {}, stranger);
      expect((await call(w, method, path, foreign, body)).statusCode).toBe(401);
    }
    await untouched(w);
  });
});

describe('every write, asked in another tenant, finds nothing', () => {
  it('reaches no row of a tenant the transaction is not in', async () => {
    const w = await world();
    const stranger = await world();
    const writes = meWritesFor(appDb, KEK);
    const now = new Date();
    const outcome = await writes.transact(stranger.tenantId, async (tx) => ({
      profile: await tx.lockProfile(w.subjectId),
      owned: await tx.lockOwnedSession(w.subjectId, w.sessionIds[0] ?? ''),
      live: await tx.liveSessionIds(w.subjectId, now, 10, null),
      consent: await tx.revokeConsent(w.subjectId, 'portal', now),
      renamed: await tx.renameCredential(w.subjectId, w.totpId, 'Taken'),
      update: await tx.updateProfile(w.subjectId, { name: 'Taken' }).catch(() => 'refused'),
      verification: await tx
        .setVerification(w.subjectId, { emailVerified: true })
        .catch(() => 'refused'),
      ended: await tx
        .endSessions({
          subjectId: w.subjectId,
          sessionIds: w.sessionIds,
          now,
          issuer: stranger.issuer,
        })
        .catch(() => 'refused'),
    }));
    expect(outcome).toMatchObject({
      profile: null,
      owned: false,
      live: [],
      consent: null,
      renamed: null,
      update: 'refused',
      verification: 'refused',
    });
    await untouched(w);
    expect(await grantRevoked(w, w.grantIds[0] ?? '')).toBe(false);
  });
});
