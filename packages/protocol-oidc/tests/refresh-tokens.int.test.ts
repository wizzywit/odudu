import { subjectRepository } from '@odudu/domain-identity';
import {
  createDatabase,
  MIGRATIONS_DIR,
  realms,
  runMigrations,
  type DatabaseHandle,
  type RealmScopedDatabase,
} from '@odudu/db';
import { expectCrossRealmMethodProbe } from '@odudu/db/testing';
import { clients } from '@odudu/domain-realm';
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

async function issueRefreshToken(tx: RealmScopedDatabase, realmId: string): Promise<string> {
  await tx.insert(realms).values({ id: realmId, name: `realm-${realmId}` });
  const clientDbId = newId();
  await tx.insert(clients).values({
    id: clientDbId,
    realmId,
    clientId: `client-${realmId}`,
    name: 'A client',
    type: 'confidential',
    secretHash: 'hashed:secret',
  });
  const subject = await subjectRepository(tx).create({ realmId, type: 'user' });
  const grant = await tokenGrantRepository(tx).create({
    realmId,
    clientId: clientDbId,
    subjectId: subject.id,
    scope: 'openid',
    audience: ['https://api.example'],
  });

  const tokenHash = hashRefreshToken(generateRefreshToken());
  await refreshTokenRepository(tx).create({
    tokenHash,
    realmId,
    grantId: grant.id,
    expiresAt: new Date(Date.now() + 1_209_600_000),
  });
  return tokenHash;
}

describe('refreshTokenRepository', () => {
  it('cannot find a refresh token by hash under a different realm context', async () => {
    await expectCrossRealmMethodProbe(app.db, {
      seed: async (tx, realmId) => issueRefreshToken(tx, realmId),
      attempt: async (tx, tokenHash) => refreshTokenRepository(tx).byHash(tokenHash),
      expectBlocked: (result) => {
        expect(result).toBeNull();
      },
    });
  });

  it('cannot consume a refresh token under a different realm context, and leaves it unused', async () => {
    await expectCrossRealmMethodProbe(app.db, {
      seed: async (tx, realmId) => issueRefreshToken(tx, realmId),
      attempt: async (tx, tokenHash) => refreshTokenRepository(tx).consume(tokenHash),
      expectBlocked: (result) => {
        expect(result).toBeNull();
      },
      verifyRealmAUnaffected: async (tx, tokenHash) => {
        const found = await refreshTokenRepository(tx).byHash(tokenHash);
        expect(found?.usedAt).toBeNull();
      },
    });
  });

  it('does not attach a replacement to a refresh token under a different realm context', async () => {
    await expectCrossRealmMethodProbe(app.db, {
      seed: async (tx, realmId) => issueRefreshToken(tx, realmId),
      attempt: async (tx, tokenHash) =>
        refreshTokenRepository(tx).attachReplacement(tokenHash, newId()),
      expectBlocked: (result) => {
        expect(result).toBeUndefined();
      },
      verifyRealmAUnaffected: async (tx, tokenHash) => {
        const found = await refreshTokenRepository(tx).byHash(tokenHash);
        expect(found?.replacedBy).toBeNull();
      },
    });
  });
});
