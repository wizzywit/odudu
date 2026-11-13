import { SessionEntry, sessionRepository, sessions } from '@odudu/authn-flows';
import { signingKeyRepository, signJwt } from '@odudu/crypto';
import { createDatabase, MIGRATIONS_DIR, runMigrations, withTenant } from '@odudu/db';
import type { DatabaseHandle } from '@odudu/db';
import { auditRepository } from '@odudu/domain-audit';
import { emailOutbox } from '@odudu/email';
import { credentialRepository, subjectRepository } from '@odudu/domain-identity';
import { loadConfig, meAudienceOfIssuer, newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { eq } from 'drizzle-orm';
import { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '#/app';
import { seed } from '#/cli/seed';
import { createLogger } from '#/logger';

// Removing a credential through the real app: the rule, the lock that makes
// two removals take turns, the gate, and what the removal leaves behind.

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
  readonly name: string;
  readonly tenantId: string;
  readonly issuer: string;
  readonly subjectId: string;
  readonly sessionId: string;
}

async function world(): Promise<World> {
  const name = `mcr-${newId()}`;
  const seeded = await seed({
    tenant: name,
    clientId: 'portal',
    redirectUris: ['https://app.example/callback'],
    username: 'ada',
    password: 'correct horse battery staple 1!',
    email: 'ada@example.com',
  });
  if (seeded.userSubjectId === undefined) throw new Error('no user');
  const { tenantId } = seeded;
  const entry = SessionEntry.issue(newId());
  await withTenant(appDb.db, tenantId, (tx) =>
    sessionRepository(tx).create({
      id: entry.id,
      tenantId,
      subjectId: seeded.userSubjectId ?? '',
      expiresAt: new Date(Date.now() + 3_600_000),
      authenticators: ['pwd'],
      secretHash: entry.secretHash(),
    }),
  );
  return {
    name,
    tenantId,
    issuer: `${BASE}/tenants/${name}`,
    subjectId: seeded.userSubjectId,
    sessionId: entry.id,
  };
}

async function hold(
  w: World,
  type: 'totp' | 'webauthn' | 'recovery-code',
  subjectId = w.subjectId,
): Promise<string> {
  return withTenant(appDb.db, w.tenantId, async (tx) => {
    const credentials = credentialRepository(tx);
    const base = { tenantId: w.tenantId, subjectId };
    if (type === 'totp') {
      await credentials.insert({
        ...base,
        type,
        secret: { kind: 'totp', secret: 'JBSWY3DPEHPK3PXP-seed', digits: 6, lastStep: 0 },
        label: 'Phone',
      });
    } else if (type === 'webauthn') {
      await credentials.insert({
        ...base,
        type,
        secret: { kind: 'webauthn', publicKey: 'pk', counter: 0, transports: [] },
        label: 'Key',
        lookupKey: `lk-${newId()}`,
      });
    } else {
      await credentials.insert({
        ...base,
        type,
        secret: { kind: 'recovery-code', hash: `h-${newId()}` },
      });
    }
    const rows = await credentials.listFor(subjectId, type);
    const newest = rows.at(-1);
    if (newest === undefined) throw new Error('nothing inserted');
    return newest.id;
  });
}

const typesHeld = (w: World, subjectId = w.subjectId) =>
  withTenant(appDb.db, w.tenantId, async (tx) => {
    const list = await credentialRepository(tx).summariesFor(subjectId, {
      after: undefined,
      limit: 50,
    });
    return list.map((c) => c.type).sort();
  });

async function dropPassword(w: World): Promise<void> {
  await owner.sql`delete from user_credentials where subject_id = ${w.subjectId} and type in ('password', 'password-history')`;
}

const requireSecondFactor = (w: World, on: boolean) =>
  owner.sql`update tenants set otp_required = ${on} where id = ${w.tenantId}`;

async function sign(w: World, claims: Record<string, unknown> = {}): Promise<string> {
  const key = await withTenant(appDb.db, w.tenantId, (tx) => signingKeyRepository(tx).active());
  const iat = Math.floor(Date.now() / 1000);
  return signJwt(
    {
      iss: w.issuer,
      sub: w.subjectId,
      aud: [meAudienceOfIssuer(w.issuer)],
      client_id: 'portal',
      sid: w.sessionId,
      scope: 'openid me:read me:write',
      iat,
      exp: iat + 600,
      ...claims,
    },
    { key, kek: KEK, typ: 'at+jwt' },
  );
}

async function remove(w: World, credentialId: string, token?: string) {
  return app.inject({
    method: 'DELETE',
    url: `/tenants/${w.name}/me/credentials/${credentialId}`,
    headers: { host: HOST, authorization: `Bearer ${token ?? (await sign(w))}` },
  });
}

const auditRows = (w: World, action: string) =>
  withTenant(appDb.db, w.tenantId, (tx) => auditRepository(tx).list({ action, limit: 50 }));

describe('DELETE /me/credentials/{id}', () => {
  it('removes a passkey while a password remains, files one audit row', async () => {
    const w = await world();
    const passkey = await hold(w, 'webauthn');
    const res = await remove(w, passkey);
    expect(res.statusCode).toBe(204);
    expect(await typesHeld(w)).toEqual(['password']);
    const rows = await auditRows(w, 'subject.credential_delete');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.detail).toEqual({
      via: 'me',
      credential_id: passkey,
      type: 'webauthn',
      notice: 'skipped_unverified',
    });
    expect(rows[0]?.actorSubjectId).toBe(w.subjectId);
  });

  it('refuses the only passkey of a person with no password, changing nothing', async () => {
    const w = await world();
    await dropPassword(w);
    const passkey = await hold(w, 'webauthn');
    const res = await remove(w, passkey);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'last_sign_in_method' });
    expect(await typesHeld(w)).toEqual(['webauthn']);
    expect(await auditRows(w, 'subject.credential_delete')).toEqual([]);
  });

  it('refuses the last TOTP where the tenant requires a second factor', async () => {
    const w = await world();
    await requireSecondFactor(w, true);
    const totp = await hold(w, 'totp');
    const res = await remove(w, totp);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'last_second_factor' });
    expect(await typesHeld(w)).toEqual(['password', 'totp']);
  });

  it('refuses the last passkey where a second factor is required, and allows it beside a TOTP', async () => {
    const w = await world();
    await requireSecondFactor(w, true);
    const passkey = await hold(w, 'webauthn');
    expect((await remove(w, passkey)).statusCode).toBe(409);
    await hold(w, 'totp');
    expect((await remove(w, passkey)).statusCode).toBe(204);
    expect(await typesHeld(w)).toEqual(['password', 'totp']);
  });

  it('removes the last TOTP where none is required and revokes the recovery codes with it', async () => {
    const w = await world();
    const totp = await hold(w, 'totp');
    await hold(w, 'recovery-code');
    await hold(w, 'recovery-code');
    const res = await remove(w, totp);
    expect(res.statusCode).toBe(204);
    expect(await typesHeld(w)).toEqual(['password']);
    const left = await withTenant(appDb.db, w.tenantId, (tx) =>
      credentialRepository(tx).recoveryStanding(w.subjectId),
    );
    expect(left.held).toBe(0);
    const revoked = await auditRows(w, 'subject.recovery_codes_revoke');
    expect(revoked).toHaveLength(1);
    expect(revoked[0]?.detail).toEqual({ via: 'me', revoked: 2, reason: 'last_factor_removed' });
  });

  it('keeps the recovery codes when a passkey goes and a TOTP remains', async () => {
    const w = await world();
    const passkey = await hold(w, 'webauthn');
    await hold(w, 'totp');
    await hold(w, 'recovery-code');
    expect((await remove(w, passkey)).statusCode).toBe(204);
    const left = await withTenant(appDb.db, w.tenantId, (tx) =>
      credentialRepository(tx).recoveryStanding(w.subjectId),
    );
    expect(left.held).toBe(1);
    expect(await auditRows(w, 'subject.recovery_codes_revoke')).toEqual([]);
  });

  it('answers 404 for another person’s credential, the password, a recovery code and a retired password', async () => {
    const w = await world();
    const stranger = await withTenant(
      appDb.db,
      w.tenantId,
      async (tx) => (await subjectRepository(tx).create({ tenantId: w.tenantId, type: 'user' })).id,
    );
    const theirs = await hold(w, 'totp', stranger);
    const code = await hold(w, 'recovery-code');
    const password = await withTenant(appDb.db, w.tenantId, async (tx) => {
      const rows = await credentialRepository(tx).summariesFor(w.subjectId, {
        after: undefined,
        limit: 10,
      });
      return rows.find((r) => r.type === 'password')?.id ?? '';
    });
    const retired = await withTenant(appDb.db, w.tenantId, async (tx) => {
      await credentialRepository(tx).insert({
        tenantId: w.tenantId,
        subjectId: w.subjectId,
        type: 'password-history',
        secret: { kind: 'password-history', hash: 'old' },
      });
      const rows = await credentialRepository(tx).listFor(w.subjectId, 'password-history');
      return rows[0]?.id ?? '';
    });
    for (const id of [theirs, code, password, retired, newId(), 'not-a-uuid']) {
      expect((await remove(w, id)).statusCode, id).toBe(404);
    }
    expect(await typesHeld(w, stranger)).toEqual(['totp']);
    expect(await typesHeld(w)).toEqual(['password']);
    expect(await auditRows(w, 'subject.credential_delete')).toEqual([]);
  });

  it('answers 404 for a credential of a person in another tenant', async () => {
    const mine = await world();
    const theirs = await world();
    const totp = await hold(theirs, 'totp');
    expect((await remove(mine, totp)).statusCode).toBe(404);
    expect(await typesHeld(theirs)).toEqual(['password', 'totp']);
  });
});

const verifyAddress = (w: World) =>
  owner.sql`update users set email_verified = true where subject_id = ${w.subjectId}`;

const mailTo = (w: World) =>
  owner.db.select().from(emailOutbox).where(eq(emailOutbox.tenantId, w.tenantId));

describe('the notice a removal sends', () => {
  it('tells a verified address once, naming the passkey, and records that it did', async () => {
    const w = await world();
    await verifyAddress(w);
    const passkey = await hold(w, 'webauthn');
    expect((await remove(w, passkey)).statusCode).toBe(204);
    const sent = await mailTo(w);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.toAddress).toBe('ada@example.com');
    expect(sent[0]?.subject).toMatch(/^A passkey was removed from your .* account$/u);
    expect(sent[0]?.bodyText).toContain('If this was not you');
    expect((await auditRows(w, 'subject.credential_delete'))[0]?.detail).toMatchObject({
      notice: 'sent',
    });
  });

  it('says the codes went when the last authenticator app took them along', async () => {
    const w = await world();
    await verifyAddress(w);
    const totp = await hold(w, 'totp');
    await hold(w, 'recovery-code');
    expect((await remove(w, totp)).statusCode).toBe(204);
    const sent = await mailTo(w);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.bodyText).toContain('recovery codes were removed with it');
  });

  it('sends nothing to an unverified address, and the removal still happens', async () => {
    const w = await world();
    const passkey = await hold(w, 'webauthn');
    expect((await remove(w, passkey)).statusCode).toBe(204);
    expect(await mailTo(w)).toEqual([]);
  });

  it('sends nothing for a removal that is refused', async () => {
    const w = await world();
    await verifyAddress(w);
    await dropPassword(w);
    const passkey = await hold(w, 'webauthn');
    expect((await remove(w, passkey)).statusCode).toBe(409);
    expect(await mailTo(w)).toEqual([]);
  });
});

describe('two removals at once', () => {
  it('leave one of the last two ways to sign in: one 204, one 409', async () => {
    const w = await world();
    await dropPassword(w);
    const a = await hold(w, 'webauthn');
    const b = await hold(w, 'webauthn');
    const [first, second] = await Promise.all([remove(w, a), remove(w, b)]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([204, 409]);
    const refused = first.statusCode === 409 ? first : second;
    expect(refused.json()).toMatchObject({ error: 'last_sign_in_method' });
    expect(await typesHeld(w)).toEqual(['webauthn']);
    expect(await auditRows(w, 'subject.credential_delete')).toHaveLength(1);
  });

  it('leave one of the last two second factors where the tenant requires one', async () => {
    const w = await world();
    await requireSecondFactor(w, true);
    const a = await hold(w, 'totp');
    const b = await hold(w, 'webauthn');
    const [first, second] = await Promise.all([remove(w, a), remove(w, b)]);
    expect([first.statusCode, second.statusCode].sort()).toEqual([204, 409]);
    expect([first, second].find((r) => r.statusCode === 409)?.json()).toMatchObject({
      error: 'last_second_factor',
    });
    expect(await typesHeld(w)).toHaveLength(2);
  });
});

describe('the gate on a removal', () => {
  const age = (w: World, seconds: number) =>
    owner.db
      .update(sessions)
      .set({ createdAt: new Date(Date.now() - seconds * 1000) })
      .where(eq(sessions.id, w.sessionId));

  it('names a second factor in the challenge for a person who holds one, and removes nothing', async () => {
    const w = await world();
    const totp = await hold(w, 'totp');
    await age(w, 600);
    const res = await remove(w, totp);
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toContain('insufficient_user_authentication');
    expect(res.headers['www-authenticate']).toContain('max_age="300"');
    expect(res.headers['www-authenticate']).toContain('acr_values="2"');
    expect(await typesHeld(w)).toEqual(['password', 'totp']);
  });

  it('asks for a recent sign-in only, where the person holds no second factor', async () => {
    const w = await world();
    const passkeyless = newId();
    await age(w, 600);
    const res = await remove(w, passkeyless);
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toContain('max_age="300"');
    expect(res.headers['www-authenticate']).not.toContain('acr_values');
  });

  it('lets a new sign-in through again', async () => {
    const w = await world();
    const totp = await hold(w, 'totp');
    await age(w, 600);
    expect((await remove(w, totp)).statusCode).toBe(401);
    await age(w, 5);
    expect((await remove(w, totp)).statusCode).toBe(204);
  });

  it('refuses a token issued to an agent, removing nothing', async () => {
    const w = await world();
    const totp = await hold(w, 'totp');
    const token = await sign(w, { act: { sub: 'agent-1', client_id: 'agent' } });
    const res = await remove(w, totp, token);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: 'agent_not_permitted' });
    expect(await typesHeld(w)).toEqual(['password', 'totp']);
  });

  it('refuses a token that may only read, naming me:write', async () => {
    const w = await world();
    const totp = await hold(w, 'totp');
    const res = await remove(w, totp, await sign(w, { scope: 'openid me:read' }));
    expect(res.statusCode).toBe(403);
    expect(res.headers['www-authenticate']).toContain('scope="me:write"');
    expect(await typesHeld(w)).toEqual(['password', 'totp']);
  });
});
