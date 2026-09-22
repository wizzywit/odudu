import { subjectRepository } from '@odudu/domain-identity';
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
import { provisionTenant } from '@odudu/authn-flows';
import { clients, provisionClientDefaults } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { authorizationCodeRepository } from '#/repository/codes';
import { generateAuthorizationCode, hashAuthorizationCode } from '#/service/authorization-code';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

const REDIRECT_URI = 'https://app.example/callback';
// RFC 7636 Appendix B worked example.
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  container = containerHandle;

  ownerHandle = createDatabase(container.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);

  const appUrl = await createAppRole(container.adminUrl);
  appHandle = createDatabase(appUrl, { max: 5 });
  app = appHandle;
}, 120_000);

afterAll(async () => {
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

async function seedTenantClientSubject(
  tx: TenantScopedDatabase,
  tenantId: string,
): Promise<{ clientDbId: string; subjectId: string }> {
  await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
  await provisionTenant(tx, tenantId);
  const clientDbId = newId();
  await tx.insert(clients).values({
    id: clientDbId,
    tenantId,
    clientId: `client-${tenantId}`,
    name: 'A client',
    type: 'confidential',
    secretHash: 'hashed:secret',
  });
  await provisionClientDefaults(tx, clientDbId);
  const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
  return { clientDbId, subjectId: subject.id };
}

async function issueCode(tx: TenantScopedDatabase, tenantId: string): Promise<string> {
  const { clientDbId, subjectId } = await seedTenantClientSubject(tx, tenantId);
  const codeHash = hashAuthorizationCode(generateAuthorizationCode());
  await authorizationCodeRepository(tx).create({
    codeHash,
    tenantId,
    clientId: clientDbId,
    subjectId,
    redirectUri: REDIRECT_URI,
    scope: 'openid',
    nonce: null,
    codeChallenge: CHALLENGE,
    codeChallengeMethod: 'S256',
    authTime: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    resource: [],
    claims: { idToken: {}, userinfo: {} },
  });
  return codeHash;
}

describe('authorizationCodeRepository', () => {
  // Not expectCrossTenantMethodProbe: `create` is an INSERT the isolation
  // policy refuses by throwing (its USING doubles as WITH CHECK — see
  // 0008_authorization_codes.sql), not by returning nothing. postgres.js's
  // `sql.begin()` rejects the whole transaction on any query error, so
  // this asserts the rejection directly — the shape
  // `consents.int.test.ts`'s own `record` probe uses, same reason.
  it('cannot create a code for another tenant from a foreign tenant context', async () => {
    const tenantA = newId();
    const tenantB = newId();

    const seeded = await withTenant(app.db, tenantA, (tx) => seedTenantClientSubject(tx, tenantA));
    await withTenant(app.db, tenantB, (tx) => seedTenantClientSubject(tx, tenantB));

    const codeHash = hashAuthorizationCode(generateAuthorizationCode());
    await expect(
      withTenant(app.db, tenantB, (tx) =>
        authorizationCodeRepository(tx).create({
          codeHash,
          tenantId: tenantA,
          clientId: seeded.clientDbId,
          subjectId: seeded.subjectId,
          redirectUri: REDIRECT_URI,
          scope: 'openid',
          nonce: null,
          codeChallenge: CHALLENGE,
          codeChallengeMethod: 'S256',
          authTime: new Date(),
          expiresAt: new Date(Date.now() + 60_000),
          resource: [],
          claims: { idToken: {}, userinfo: {} },
        }),
      ),
    ).rejects.toThrow();

    const found = await withTenant(app.db, tenantA, (tx) =>
      authorizationCodeRepository(tx).byHash(codeHash),
    );
    expect(found).toBeNull();
  });

  it('cannot find a code by hash under a different tenant context', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => issueCode(tx, tenantId),
      verifySeeded: async (tx, codeHash) => {
        const found = await authorizationCodeRepository(tx).byHash(codeHash);
        expect(found).not.toBeNull();
      },
      attempt: async (tx, codeHash) => authorizationCodeRepository(tx).byHash(codeHash),
      expectBlocked: (result) => {
        expect(result).toBeNull();
      },
    });
  });

  it('cannot consume a code under a different tenant context, and leaves it unconsumed', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => issueCode(tx, tenantId),
      verifySeeded: async (tx, codeHash) => {
        const found = await authorizationCodeRepository(tx).byHash(codeHash);
        expect(found?.consumedAt).toBeNull();
      },
      attempt: async (tx, codeHash) => authorizationCodeRepository(tx).consume(codeHash),
      expectBlocked: (result) => {
        expect(result).toBeNull();
      },
      verifyTenantAUnaffected: async (tx, codeHash) => {
        const found = await authorizationCodeRepository(tx).byHash(codeHash);
        expect(found?.consumedAt).toBeNull();
      },
    });
  });

  it('does not attach a grant to a code under a different tenant context', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => issueCode(tx, tenantId),
      verifySeeded: async (tx, codeHash) => {
        const found = await authorizationCodeRepository(tx).byHash(codeHash);
        expect(found?.grantId).toBeNull();
      },
      attempt: async (tx, codeHash) =>
        authorizationCodeRepository(tx).attachGrant(codeHash, newId()),
      expectBlocked: (result) => {
        expect(result).toBeUndefined();
      },
      verifyTenantAUnaffected: async (tx, codeHash) => {
        const found = await authorizationCodeRepository(tx).byHash(codeHash);
        expect(found?.grantId).toBeNull();
      },
    });
  });
});
