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

async function seedRealmClientSubject(
  tx: RealmScopedDatabase,
  realmId: string,
): Promise<{ clientDbId: string; subjectId: string }> {
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
  return { clientDbId, subjectId: subject.id };
}

async function issueCode(tx: RealmScopedDatabase, realmId: string): Promise<string> {
  const { clientDbId, subjectId } = await seedRealmClientSubject(tx, realmId);
  const codeHash = hashAuthorizationCode(generateAuthorizationCode());
  await authorizationCodeRepository(tx).create({
    codeHash,
    realmId,
    clientId: clientDbId,
    subjectId,
    redirectUri: REDIRECT_URI,
    scope: 'openid',
    nonce: null,
    codeChallenge: CHALLENGE,
    codeChallengeMethod: 'S256',
    authTime: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
  });
  return codeHash;
}

describe('authorizationCodeRepository', () => {
  it('cannot find a code by hash under a different realm context', async () => {
    await expectCrossRealmMethodProbe(app.db, {
      seed: async (tx, realmId) => issueCode(tx, realmId),
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

  it('cannot consume a code under a different realm context, and leaves it unconsumed', async () => {
    await expectCrossRealmMethodProbe(app.db, {
      seed: async (tx, realmId) => issueCode(tx, realmId),
      verifySeeded: async (tx, codeHash) => {
        const found = await authorizationCodeRepository(tx).byHash(codeHash);
        expect(found?.consumedAt).toBeNull();
      },
      attempt: async (tx, codeHash) => authorizationCodeRepository(tx).consume(codeHash),
      expectBlocked: (result) => {
        expect(result).toBeNull();
      },
      verifyRealmAUnaffected: async (tx, codeHash) => {
        const found = await authorizationCodeRepository(tx).byHash(codeHash);
        expect(found?.consumedAt).toBeNull();
      },
    });
  });

  it('does not attach a grant to a code under a different realm context', async () => {
    await expectCrossRealmMethodProbe(app.db, {
      seed: async (tx, realmId) => issueCode(tx, realmId),
      verifySeeded: async (tx, codeHash) => {
        const found = await authorizationCodeRepository(tx).byHash(codeHash);
        expect(found?.grantId).toBeNull();
      },
      attempt: async (tx, codeHash) =>
        authorizationCodeRepository(tx).attachGrant(codeHash, newId()),
      expectBlocked: (result) => {
        expect(result).toBeUndefined();
      },
      verifyRealmAUnaffected: async (tx, codeHash) => {
        const found = await authorizationCodeRepository(tx).byHash(codeHash);
        expect(found?.grantId).toBeNull();
      },
    });
  });
});
