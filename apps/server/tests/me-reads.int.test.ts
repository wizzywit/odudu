import { SessionEntry, sessionRepository } from '@odudu/authn-flows';
import { signingKeyRepository, signJwt } from '@odudu/crypto';
import { createDatabase, MIGRATIONS_DIR, runMigrations, withTenant } from '@odudu/db';
import type { DatabaseHandle } from '@odudu/db';
import { MAX_LIMIT } from '@odudu/contracts/me';
import { credentialRepository, subjectRepository, userRepository } from '@odudu/domain-identity';
import { clientRepository, clientScopeRepository, consentRepository } from '@odudu/domain-tenant';
import { loadConfig, mcpAudienceOfIssuer, meAudienceOfIssuer, newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '#/app';
import { seed } from '#/cli/seed';
import { createLogger } from '#/logger';
import { meReadsFor } from '#/me-deps';

// The "me" reads through the real app: real signing keys, a real database.

let container: TestDatabase;
let owner: DatabaseHandle;
let appDb: DatabaseHandle;
let app: FastifyInstance;

const KEK = Buffer.alloc(32, 7);
const BASE = 'https://id.example.com';
const HOST = 'id.example.com';
const TOTP_SEED = 'JBSWY3DPEHPK3PXP-seed';
const PASSKEY_KEY = 'passkey-public-key-material';
const CODE_HASH = 'recovery-code-hash-material';

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
  readonly sessionIds: string[];
  readonly passwordHash: string;
}

async function openSession(
  w: { tenantId: string },
  tx: Parameters<Parameters<typeof withTenant>[2]>[0],
  subjectId: string,
  expiresAt: Date,
): Promise<string> {
  const entry = SessionEntry.issue(newId());
  await sessionRepository(tx).create({
    id: entry.id,
    tenantId: w.tenantId,
    subjectId,
    expiresAt,
    authenticators: ['pwd'],
    secretHash: entry.secretHash(),
  });
  return entry.id;
}

// A tenant, a person with every kind of credential, two live sessions and a
// dead one, a consent; and a second person in the same tenant with rows of
// their own that must never appear.
async function world(): Promise<World> {
  const name = `me-${newId()}`;
  const ahead = new Date(Date.now() + 24 * 3600_000);
  const behind = new Date(Date.now() - 24 * 3600_000);
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
    const otherSubject = await subjectRepository(tx).create({ tenantId, type: 'user' });
    const otherSubjectId = otherSubject.id;
    await userRepository(tx).create({
      subjectId: otherSubjectId,
      tenantId,
      username: 'grace',
      email: 'grace@example.com',
    });
    const credentials = credentialRepository(tx);
    for (const who of [subjectId, otherSubjectId]) {
      await credentials.insert({
        tenantId,
        subjectId: who,
        type: 'totp',
        secret: { kind: 'totp', secret: TOTP_SEED, digits: 6, lastStep: 0 },
        label: who === subjectId ? 'Phone' : 'Grace phone',
      });
      await credentials.insert({
        tenantId,
        subjectId: who,
        type: 'webauthn',
        secret: { kind: 'webauthn', publicKey: PASSKEY_KEY, counter: 0, transports: [] },
        label: who === subjectId ? 'Laptop key' : 'Grace key',
        lookupKey: `lk-${newId()}`,
      });
      for (let i = 0; i < 3; i += 1) {
        await credentials.insert({
          tenantId,
          subjectId: who,
          type: 'recovery-code',
          secret: { kind: 'recovery-code', hash: `${CODE_HASH}-${String(i)}` },
        });
      }
    }
    const spent = (await credentials.listFor(subjectId, 'recovery-code'))[0];
    if (spent === undefined) throw new Error('no code');
    await credentials.spendRecoveryCode(spent.id, new Date());
    const passwordHash = await credentials.passwordFor(subjectId);
    if (passwordHash === null) throw new Error('no password');

    const sessionIds = [
      await openSession({ tenantId }, tx, subjectId, ahead),
      await openSession({ tenantId }, tx, subjectId, ahead),
    ];
    await openSession({ tenantId }, tx, subjectId, behind);
    await openSession({ tenantId }, tx, otherSubjectId, ahead);

    const client = await clientRepository(tx).byClientId('portal');
    const scopes = await clientScopeRepository(tx).allForTenant();
    const scopeIds = scopes.filter((s) => ['openid', 'profile'].includes(s.name)).map((s) => s.id);
    if (client === null) throw new Error('no client');
    await consentRepository(tx).record(tenantId, subjectId, client.id, scopeIds);
    await consentRepository(tx).record(tenantId, otherSubjectId, client.id, scopeIds);
    return {
      tenantId,
      name,
      issuer: `${BASE}/tenants/${name}`,
      subjectId,
      otherSubjectId,
      sessionIds: sessionIds.sort(),
      passwordHash,
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
      scope: 'openid me:read',
      iat,
      exp: iat + 600,
      ...claims,
    },
    { key, kek: KEK, typ: 'at+jwt' },
  );
}

async function get(w: World, path: string, token: string | null) {
  return app.inject({
    method: 'GET',
    url: `/tenants/${w.name}/me/${path}`,
    headers: {
      host: HOST,
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
    },
  });
}

function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)]);
}

interface Page<Item> {
  items: Item[];
  next_cursor: string | null;
}

describe('each read answers with the token’s own subject’s rows', () => {
  it('the profile', async () => {
    const w = await world();
    const res = await get(w, 'profile', await sign(w));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      sub: w.subjectId,
      username: 'ada',
      email: 'ada@example.com',
    });
  });

  it('the profile of the other person, for their own token', async () => {
    const w = await world();
    const res = await get(w, 'profile', await sign(w, { sub: w.otherSubjectId }));
    expect(res.json()).toMatchObject({ username: 'grace' });
  });

  it('the credentials, with the recovery codes left and no recovery code listed', async () => {
    const w = await world();
    const res = await get(w, 'credentials', await sign(w));
    const body = res.json<
      Page<{ type: string; label: string | null }> & {
        recovery_codes_left: number;
      }
    >();
    expect(res.statusCode).toBe(200);
    expect(body.items.map((c) => c.type).sort()).toEqual(['password', 'totp', 'webauthn']);
    expect(body.items.map((c) => c.label)).toEqual(expect.arrayContaining(['Phone', 'Laptop key']));
    expect(body.items.map((c) => c.label)).not.toContain('Grace phone');
    expect(body.recovery_codes_left).toBe(2);
  });

  it('the live sessions, marking the token’s own', async () => {
    const w = await world();
    const res = await get(w, 'sessions', await sign(w));
    const body = res.json<Page<{ id: string; current: boolean; device: unknown }>>();
    expect(body.items.map((s) => s.id)).toEqual(w.sessionIds);
    expect(body.items.find((s) => s.id === w.sessionIds[0])?.current).toBe(true);
    expect(body.items.every((s) => s.device === null)).toBe(true);
    expect(body.next_cursor).toBeNull();
  });

  it('the consents', async () => {
    const w = await world();
    const res = await get(w, 'consents', await sign(w));
    const body = res.json<Page<{ client_id: string; scope_names: string[] }>>();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.client_id).toBe('portal');
    expect([...(body.items[0]?.scope_names ?? [])].sort()).toEqual(['openid', 'profile']);
  });
});

describe('a person with more sessions than a page holds', () => {
  it('gets a page bounded by MAX_LIMIT and a cursor that reaches the rest', async () => {
    const w = await world();
    await withTenant(appDb.db, w.tenantId, async (tx) => {
      for (let i = 0; i < MAX_LIMIT - 1; i += 1) {
        await openSession(w, tx, w.subjectId, new Date(Date.now() + 3600_000));
      }
    });
    const token = await sign(w);
    const all = MAX_LIMIT + 1;

    const first = await get(w, `sessions?limit=${String(all + 50)}`, token);
    const page = first.json<Page<{ id: string }>>();
    expect(page.items).toHaveLength(MAX_LIMIT);
    expect(page.next_cursor).not.toBeNull();

    const second = await get(
      w,
      `sessions?limit=${String(all)}&cursor=${encodeURIComponent(page.next_cursor ?? '')}`,
      token,
    );
    const rest = second.json<Page<{ id: string }>>();
    expect(rest.items).toHaveLength(1);
    expect(rest.next_cursor).toBeNull();
    const ids = [...page.items, ...rest.items].map((s) => s.id);
    expect(new Set(ids).size).toBe(all);
  });

  it('refuses a cursor that is not one it issued, and one from another list', async () => {
    const w = await world();
    const token = await sign(w);
    expect((await get(w, 'sessions?cursor=junk', token)).statusCode).toBe(400);
    const sessions = await get(w, 'sessions?limit=1', token);
    const cursor = sessions.json<Page<unknown>>().next_cursor ?? '';
    expect(cursor).not.toBe('');
    expect(
      (await get(w, `credentials?cursor=${encodeURIComponent(cursor)}`, token)).statusCode,
    ).toBe(400);
  });
});

describe('no secret crosses it', () => {
  it('names no secret in any key and holds none of the stored material in any value', async () => {
    const w = await world();
    const token = await sign(w);
    const forbidden = /secret|seed|hash|key|token|lookup|public|private|counter|salt|password_/iu;
    for (const path of ['profile', 'credentials', 'sessions', 'consents']) {
      const res = await get(w, path, token);
      expect(res.statusCode, path).toBe(200);
      const keys = keysOf(res.json());
      expect(
        keys.filter((key) => forbidden.test(key)),
        `${path} carries a key that could hold a secret`,
      ).toEqual([]);
      for (const material of [TOTP_SEED, PASSKEY_KEY, CODE_HASH, w.passwordHash]) {
        expect(res.payload, path).not.toContain(material);
      }
    }
  });
});

describe('the door', () => {
  it('refuses a token holding me:write alone, naming the scope it needs', async () => {
    const w = await world();
    const token = await sign(w, { scope: 'openid me:write' });
    for (const path of ['profile', 'credentials', 'sessions', 'consents']) {
      const res = await get(w, path, token);
      expect(res.statusCode, path).toBe(403);
      expect(res.headers['www-authenticate']).toBe(
        'Bearer error="insufficient_scope", scope="me:read"',
      );
    }
  });

  it('allows the audiences a sign-in gives a token: the me URL and the issuer', async () => {
    const w = await world();
    const token = await sign(w, { aud: [meAudienceOfIssuer(w.issuer), w.issuer] });
    expect((await get(w, 'profile', token)).statusCode).toBe(200);
  });

  it('allows a token marked for an agent to read', async () => {
    const w = await world();
    const token = await sign(w, { act: { sub: 'agent-1' } });
    for (const path of ['profile', 'credentials', 'sessions', 'consents']) {
      expect((await get(w, path, token)).statusCode, path).toBe(200);
    }
  });

  it('challenges a request with no token', async () => {
    const w = await world();
    const res = await get(w, 'profile', null);
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe('Bearer');
  });

  it('refuses another tenant’s token, and an MCP token', async () => {
    const w = await world();
    const stranger = await world();
    const foreign = await sign(w, {}, stranger);
    expect((await get(w, 'profile', foreign)).statusCode).toBe(401);
    const mcp = await sign(w, { aud: [mcpAudienceOfIssuer(w.issuer)], scope: 'openid mcp:read' });
    expect((await get(w, 'profile', mcp)).statusCode).toBe(401);
  });

  it('takes no subject in a path or a query', async () => {
    const w = await world();
    const token = await sign(w);
    expect((await get(w, `sessions?subject=${w.otherSubjectId}`, token)).statusCode).toBe(400);
    expect((await get(w, `profile?subject=${w.otherSubjectId}`, token)).statusCode).toBe(400);
    expect((await get(w, `${w.otherSubjectId}/profile`, token)).statusCode).toBe(404);
  });
});

describe('the reads, asked in another tenant, find nothing', () => {
  it('returns nothing for a subject of a tenant the context is not', async () => {
    const w = await world();
    const stranger = await world();
    const reads = meReadsFor(appDb);
    const page = { after: undefined, limit: 50 };
    const lifespans = {
      ssoSessionIdleSeconds: 1800,
      ssoSessionMaxSeconds: 36_000,
      rememberMeIdleSeconds: 604_800,
      rememberMeMaxSeconds: 2_592_000,
    };

    expect(await reads.profile(stranger.tenantId, w.subjectId)).toBeNull();
    expect(await reads.credentials(stranger.tenantId, w.subjectId, page)).toEqual({
      rows: [],
      recoveryCodesLeft: 0,
    });
    expect(
      await reads.sessions(stranger.tenantId, w.subjectId, lifespans, new Date(), page),
    ).toEqual([]);
    expect(await reads.consents(stranger.tenantId, w.subjectId, page)).toEqual([]);
  });
});
