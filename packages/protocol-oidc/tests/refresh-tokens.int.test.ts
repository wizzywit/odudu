import { subjectRepository } from '@odudu/domain-identity';
import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { expectCrossTenantMethodProbe } from '@odudu/db/testing';
import { provisionTenant } from '@odudu/authn-flows';
import { clients, provisionClientDefaults } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tokenGrantRepository } from '#/repository/grants';
import { refreshTokenRepository } from '#/repository/refresh';
import { generateRefreshToken, hashRefreshToken } from '#/service/refresh';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

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

async function issueRefreshToken(tx: TenantScopedDatabase, tenantId: string): Promise<string> {
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
  const grant = await tokenGrantRepository(tx).create({
    id: newId(),
    tenantId,
    clientId: clientDbId,
    subjectId: subject.id,
    scope: 'openid',
    audience: ['https://api.example'],
  });

  const tokenHash = hashRefreshToken(generateRefreshToken());
  await refreshTokenRepository(tx).create({
    tokenHash,
    tenantId,
    grantId: grant.id,
    expiresAt: new Date(Date.now() + 1_209_600_000),
  });
  return tokenHash;
}

describe('refreshTokenRepository', () => {
  it('cannot find a refresh token by hash under a different tenant context', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => issueRefreshToken(tx, tenantId),
      verifySeeded: async (tx, tokenHash) => {
        const found = await refreshTokenRepository(tx).byHash(tokenHash);
        expect(found).not.toBeNull();
      },
      attempt: async (tx, tokenHash) => refreshTokenRepository(tx).byHash(tokenHash),
      expectBlocked: (result) => {
        expect(result).toBeNull();
      },
    });
  });

  it('cannot consume a refresh token under a different tenant context, and leaves it unused', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => issueRefreshToken(tx, tenantId),
      verifySeeded: async (tx, tokenHash) => {
        const found = await refreshTokenRepository(tx).byHash(tokenHash);
        expect(found?.usedAt).toBeNull();
      },
      attempt: async (tx, tokenHash) => refreshTokenRepository(tx).consume(tokenHash),
      expectBlocked: (result) => {
        expect(result).toBeNull();
      },
      verifyTenantAUnaffected: async (tx, tokenHash) => {
        const found = await refreshTokenRepository(tx).byHash(tokenHash);
        expect(found?.usedAt).toBeNull();
      },
    });
  });

  it('does not attach a replacement to a refresh token under a different tenant context', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => issueRefreshToken(tx, tenantId),
      verifySeeded: async (tx, tokenHash) => {
        const found = await refreshTokenRepository(tx).byHash(tokenHash);
        expect(found?.replacedBy).toBeNull();
      },
      attempt: async (tx, tokenHash) =>
        refreshTokenRepository(tx).attachReplacement(tokenHash, newId()),
      expectBlocked: (result) => {
        expect(result).toBeUndefined();
      },
      verifyTenantAUnaffected: async (tx, tokenHash) => {
        const found = await refreshTokenRepository(tx).byHash(tokenHash);
        expect(found?.replacedBy).toBeNull();
      },
    });
  });
});
