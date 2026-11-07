import { provisionTenant } from '@odudu/authn-flows';
import { generateSigningKey, signingKeys } from '@odudu/crypto';
import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { expectCrossTenantMethodProbe } from '@odudu/db/testing';
import { roleRepository } from '@odudu/domain-authz';
import { hashPassword } from '@odudu/domain-identity';
import { clientRepository, provisionClientDefaults, type ClientRecord } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import formbody from '@fastify/formbody';
import { sql } from 'drizzle-orm';
import Fastify, { type FastifyInstance, type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { oidcRoutes } from '#/index';
import { NO_CLIENT_KEY_FETCHER } from '#/repository/client-keys';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { UNLIMITED_AUDIT_REFUSAL_BUDGET } from '#/service/audit-refusal-budget';
import { UNLIMITED_CLIENT_SECRET_LIMITER } from '#/service/client-secret-throttle';
import { ensureServiceAccount, retireServiceAccount } from '#/usecase/service-account';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;
let httpApp: FastifyInstance | undefined;

let owner: DatabaseHandle;
let app: DatabaseHandle;
let http: FastifyInstance;

const KEK = Buffer.alloc(32, 12);
const SECRET = 's3cret-leaked';

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  ownerHandle = createDatabase(containerHandle.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);
  appHandle = createDatabase(await createAppRole(containerHandle.adminUrl), { max: 8 });
  app = appHandle;

  http = Fastify();
  await http.register(formbody);
  await http.register(
    oidcRoutes({
      tls: false,
      database: app,
      ownerDatabase: owner,
      kek: KEK,
      clientSecretLimiter: UNLIMITED_CLIENT_SECRET_LIMITER,
      auditRefusalBudget: UNLIMITED_AUDIT_REFUSAL_BUDGET,
      clientKeySet: NO_CLIENT_KEY_FETCHER,
    }),
  );
  await http.ready();
  httpApp = http;
}, 120_000);

afterAll(async () => {
  await httpApp?.close();
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

interface World {
  readonly name: string;
  readonly id: string;
}

async function world(): Promise<World> {
  const name = `svc-acct-${newId()}`;
  const id = newId();
  await withTenant(app.db, id, async (tx) => {
    await tx.insert(tenants).values({ id, name });
    await provisionTenant(tx, id);
    const key = await generateSigningKey('RS256', KEK);
    await tx.insert(signingKeys).values({
      id: newId(),
      tenantId: id,
      kid: key.kid,
      alg: key.alg,
      status: 'active',
      publicJwk: key.publicJwk,
      privateJwkEncrypted: key.privateJwkEncrypted,
    });
  });
  return { name, id };
}

// A confidential client created the way every door now creates one: no
// account until the grant says it needs one.
async function client(w: World, clientId: string, grantTypes: string[]): Promise<ClientRecord> {
  return withTenant(app.db, w.id, async (tx) => {
    const created = await clientRepository(tx).create({
      tenantId: w.id,
      clientId,
      name: clientId,
      type: 'confidential',
      secretHash: await hashPassword(SECRET),
    });
    await provisionClientDefaults(tx, created.id);
    await clientOidcConfigRepository(tx).create({
      clientId: created.id,
      tenantId: w.id,
      redirectUris: ['https://app.example/cb'],
      grantTypes,
      tokenEndpointAuthMethod: 'client_secret_basic',
      audiences: ['https://api.example'],
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 3600,
      clientCredentialsScopes: ['reports:read'],
    });
    return created;
  });
}

async function setGrants(w: World, clientDbId: string, grantTypes: string[]): Promise<void> {
  await withTenant(app.db, w.id, async (tx) => {
    await clientOidcConfigRepository(tx).update(clientDbId, { grantTypes });
  });
}

async function token(w: World, clientId: string): Promise<LightMyRequestResponse> {
  return http.inject({
    method: 'POST',
    url: `/tenants/${w.name}/protocol/openid-connect/token`,
    payload: 'grant_type=client_credentials&scope=reports%3Aread',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${clientId}:${SECRET}`).toString('base64')}`,
    },
  });
}

function subOf(res: LightMyRequestResponse): string {
  const jwt = res.json<{ access_token: string }>().access_token;
  const segment = jwt.split('.')[1] ?? '';
  return (JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as { sub: string }).sub;
}

async function serviceSubjects(w: World): Promise<number> {
  return withTenant(app.db, w.id, async (tx) => {
    const rows = await tx.execute<{ n: number }>(
      sql`select count(*)::int as n from subjects where type = 'service'`,
    );
    return rows[0]?.n ?? 0;
  });
}

async function held(w: World, clientDbId: string): Promise<ClientRecord> {
  return withTenant(app.db, w.id, async (tx) => {
    const row = await clientRepository(tx).byId(clientDbId);
    if (row === null) throw new Error('client vanished');
    return row;
  });
}

async function giveRole(w: World, subjectId: string): Promise<void> {
  await withTenant(app.db, w.id, async (tx) => {
    const role = await roleRepository(tx).create({ tenantId: w.id, name: `reader-${newId()}` });
    await roleRepository(tx).assignToSubject(subjectId, role.id);
  });
}

async function roleCount(w: World, subjectId: string): Promise<number> {
  return withTenant(app.db, w.id, async (tx) => {
    const rows = await tx.execute<{ n: number }>(
      sql`select count(*)::int as n from subject_roles where subject_id = ${subjectId}`,
    );
    return rows[0]?.n ?? 0;
  });
}

describe('ensureServiceAccount', () => {
  it('gives a client one account and returns it again on every later call', async () => {
    const w = await world();
    const created = await client(w, 'batch', ['client_credentials']);
    expect(created.serviceSubjectId).toBeNull();
    expect(await serviceSubjects(w)).toBe(0);

    const first = await withTenant(app.db, w.id, (tx) => ensureServiceAccount(tx, created));
    const second = await withTenant(app.db, w.id, (tx) => ensureServiceAccount(tx, created));
    expect(first.serviceSubjectId).not.toBeNull();
    expect(second.serviceSubjectId).toBe(first.serviceSubjectId);
    expect(await serviceSubjects(w)).toBe(1);
    expect((await held(w, created.id)).serviceSubjectId).toBe(first.serviceSubjectId);
  });

  it('creates exactly one account when run by several transactions at once', async () => {
    const w = await world();
    const created = await client(w, 'raced', ['client_credentials']);
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        withTenant(app.db, w.id, (tx) => ensureServiceAccount(tx, created)),
      ),
    );
    expect(new Set(results.map((r) => r.serviceSubjectId)).size).toBe(1);
    expect(await serviceSubjects(w)).toBe(1);
  });

  it('refuses a public client, which never has one', async () => {
    const w = await world();
    const publicClient = await withTenant(app.db, w.id, (tx) =>
      clientRepository(tx).create({
        tenantId: w.id,
        clientId: 'spa',
        name: 'spa',
        type: 'public',
        secretHash: null,
      }),
    );
    await expect(
      withTenant(app.db, w.id, (tx) => ensureServiceAccount(tx, publicClient)),
    ).rejects.toThrow(/public client/);
    expect(await serviceSubjects(w)).toBe(0);
  });

  it('cannot give an account to a client of another tenant', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx: TenantScopedDatabase, tenantId) => {
        await tx.insert(tenants).values({ id: tenantId, name: `probe-${tenantId}` });
        return clientRepository(tx).create({
          tenantId,
          clientId: 'probe',
          name: 'probe',
          type: 'confidential',
          secretHash: 'x',
        });
      },
      verifySeeded: async (tx, seeded) => {
        expect((await clientRepository(tx).byId(seeded.id))?.serviceSubjectId).toBeNull();
      },
      attempt: async (tx, seeded) => {
        try {
          await ensureServiceAccount(tx, seeded);
          return 'succeeded';
        } catch {
          return 'blocked';
        }
      },
      expectBlocked: (result) => {
        expect(result).toBe('blocked');
      },
      verifyTenantAUnaffected: async (tx, seeded) => {
        expect((await clientRepository(tx).byId(seeded.id))?.serviceSubjectId).toBeNull();
      },
    });
  });
});

describe('an account the upgrade left idle', () => {
  async function idleFlag(w: World, clientDbId: string): Promise<boolean> {
    return withTenant(app.db, w.id, async (tx) => {
      const rows = await tx.execute<{ idle: boolean }>(
        sql`select service_account_idle as idle from clients where id = ${clientDbId}`,
      );
      return rows[0]?.idle ?? false;
    });
  }

  it('stops being marked idle once the grant is on and the account is ensured, keeping its roles', async () => {
    const w = await world();
    const created = await client(w, 'revived', ['client_credentials']);
    const account = await withTenant(app.db, w.id, (tx) => ensureServiceAccount(tx, created));
    await giveRole(w, account.serviceSubjectId ?? '');
    await withTenant(app.db, w.id, (tx) =>
      tx.execute(sql`update clients set service_account_idle = true where id = ${created.id}`),
    );
    expect(await idleFlag(w, created.id)).toBe(true);

    const again = await withTenant(app.db, w.id, (tx) => ensureServiceAccount(tx, created));
    expect(again.serviceSubjectId).toBe(account.serviceSubjectId);
    expect(await idleFlag(w, created.id)).toBe(false);
    expect(await roleCount(w, account.serviceSubjectId ?? '')).toBe(1);
  });
});

describe('retireServiceAccount', () => {
  it('leaves no path to a bearer: the grant is refused, what it issued and held goes, a leaked secret buys nothing', async () => {
    const w = await world();
    const created = await client(w, 'leaky', ['client_credentials']);
    const withAccount = await withTenant(app.db, w.id, (tx) => ensureServiceAccount(tx, created));
    const subject = withAccount.serviceSubjectId ?? '';
    await giveRole(w, subject);

    const issued = await token(w, 'leaky');
    expect(issued.statusCode).toBe(200);
    expect(subOf(issued)).toBe(subject);
    const grantsBefore = await withTenant(app.db, w.id, async (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from token_grants where subject_id = ${subject}`,
      ),
    );
    expect(grantsBefore[0]?.n).toBe(1);

    await setGrants(w, created.id, ['authorization_code']);
    const retired = await withTenant(app.db, w.id, (tx) => retireServiceAccount(tx, withAccount));
    expect(retired.serviceSubjectId).toBeNull();

    const refused = await token(w, 'leaky');
    expect(refused.statusCode).toBe(400);
    expect(refused.json<{ error: string }>().error).toBe('unauthorized_client');

    await withTenant(app.db, w.id, async (tx) => {
      const left = await tx.execute<{ grants: number; roles: number; subjects: number }>(sql`
        select (select count(*)::int from token_grants where subject_id = ${subject}) as grants,
               (select count(*)::int from subject_roles where subject_id = ${subject}) as roles,
               (select count(*)::int from subjects where id = ${subject}) as subjects`);
      expect(left[0]).toEqual({ grants: 0, roles: 0, subjects: 0 });
    });
    expect((await held(w, created.id)).serviceSubjectId).toBeNull();
  });

  it('is a no-op for a client with no account, however often it runs', async () => {
    const w = await world();
    const created = await client(w, 'plain', ['authorization_code']);
    const again = await withTenant(app.db, w.id, (tx) => retireServiceAccount(tx, created));
    expect(again.serviceSubjectId).toBeNull();
    expect(await serviceSubjects(w)).toBe(0);
  });

  it('does not bring back the old roles when the grant is switched on again', async () => {
    const w = await world();
    const created = await client(w, 'cycled', ['client_credentials']);
    const first = await withTenant(app.db, w.id, (tx) => ensureServiceAccount(tx, created));
    await giveRole(w, first.serviceSubjectId ?? '');

    await setGrants(w, created.id, ['authorization_code']);
    await withTenant(app.db, w.id, (tx) => retireServiceAccount(tx, first));
    await setGrants(w, created.id, ['authorization_code', 'client_credentials']);
    const second = await withTenant(app.db, w.id, (tx) => ensureServiceAccount(tx, created));

    expect(second.serviceSubjectId).not.toBeNull();
    expect(second.serviceSubjectId).not.toBe(first.serviceSubjectId);
    expect(await roleCount(w, second.serviceSubjectId ?? '')).toBe(0);
    expect(await serviceSubjects(w)).toBe(1);
  });

  it('cannot retire the account of a client of another tenant', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx: TenantScopedDatabase, tenantId) => {
        await tx.insert(tenants).values({ id: tenantId, name: `probe-${tenantId}` });
        const created = await clientRepository(tx).create({
          tenantId,
          clientId: 'probe',
          name: 'probe',
          type: 'confidential',
          secretHash: 'x',
        });
        return ensureServiceAccount(tx, created);
      },
      verifySeeded: async (tx, seeded) => {
        expect((await clientRepository(tx).byId(seeded.id))?.serviceSubjectId).toBe(
          seeded.serviceSubjectId,
        );
      },
      attempt: async (tx, seeded) => {
        try {
          await retireServiceAccount(tx, seeded);
          return 'succeeded';
        } catch {
          return 'blocked';
        }
      },
      expectBlocked: (result) => {
        expect(result).toBe('blocked');
      },
      verifyTenantAUnaffected: async (tx, seeded) => {
        expect((await clientRepository(tx).byId(seeded.id))?.serviceSubjectId).toBe(
          seeded.serviceSubjectId,
        );
        const rows = await tx.execute<{ n: number }>(
          sql`select count(*)::int as n from subjects where id = ${seeded.serviceSubjectId}`,
        );
        expect(rows[0]?.n).toBe(1);
      },
    });
  });
});

describe('a token request racing the retirement of the account', () => {
  it('is refused as unauthorized_client, not left to fail on the subject it named', async () => {
    const w = await world();
    const created = await client(w, 'racer', ['client_credentials']);
    const account = await withTenant(app.db, w.id, (tx) => ensureServiceAccount(tx, created));
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let retiring: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      retiring = resolve;
    });
    const retirement = withTenant(app.db, w.id, async (tx) => {
      await retireServiceAccount(tx, account);
      retiring();
      await held;
    });
    await started;
    const request = token(w, 'racer');
    await new Promise((resolve) => setTimeout(resolve, 400));
    release();
    await retirement;
    const res = await request;
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe('unauthorized_client');
  });
});

describe('a client that keeps the client_credentials grant', () => {
  it('issues for the same subject before and after an unrelated grant change', async () => {
    const w = await world();
    const created = await client(w, 'steady', ['client_credentials']);
    const account = await withTenant(app.db, w.id, (tx) => ensureServiceAccount(tx, created));
    const before = await token(w, 'steady');
    expect(before.statusCode).toBe(200);

    await setGrants(w, created.id, ['client_credentials', 'authorization_code']);
    await withTenant(app.db, w.id, (tx) => ensureServiceAccount(tx, account));
    const after = await token(w, 'steady');
    expect(after.statusCode).toBe(200);
    expect(subOf(after)).toBe(subOf(before));
    expect(await serviceSubjects(w)).toBe(1);
  });
});
