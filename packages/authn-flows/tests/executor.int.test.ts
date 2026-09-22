import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { expectTenantIsolation } from '@odudu/db/testing';
import { subjectRepository } from '@odudu/domain-identity';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { establishSession, loadPendingRequest, startAuthentication } from '#/usecase/executor';
import { sessions } from '#/schema/sessions';
import { type PendingRequest } from '#/schema/authentication-sessions';

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

const request: PendingRequest = {
  clientId: 'client-1',
  redirectUri: 'https://client.example/callback',
  scope: 'openid',
  state: null,
  nonce: null,
  codeChallenge: 'challenge-value',
  codeChallengeMethod: 'S256',
};

async function seedTenant(tx: TenantScopedDatabase, tenantId: string): Promise<void> {
  await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
}

describe('tenant isolation', () => {
  it.each(['authentication_sessions', 'sessions'])('isolates %s by tenant', async (table) => {
    await expectTenantIsolation(app.db, {
      table,
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        if (table === 'authentication_sessions') {
          await startAuthentication(tx, tenantId, request);
        } else {
          const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
          await establishSession(tx, tenantId, subject.id, 36_000, ['password']);
        }
      },
    });
  });
});

describe('cross-tenant resume is blocked', () => {
  it('cannot load a pending request parked under a different tenant context', async () => {
    const tenantA = newId();
    const tenantB = newId();

    const authSessionId = await withTenant(app.db, tenantA, async (tx) => {
      await seedTenant(tx, tenantA);
      return (await startAuthentication(tx, tenantA, request)).authSessionId;
    });

    await withTenant(app.db, tenantB, async (tx) => seedTenant(tx, tenantB));

    const loadedFromB = await withTenant(app.db, tenantB, async (tx) =>
      loadPendingRequest(tx, authSessionId),
    );
    expect(loadedFromB).toBeNull();

    const loadedFromA = await withTenant(app.db, tenantA, async (tx) =>
      loadPendingRequest(tx, authSessionId),
    );
    expect(loadedFromA).toEqual(request);
  });

  it('cannot resume a session established under a different tenant context', async () => {
    const tenantA = newId();
    const tenantB = newId();

    const sessionId = await withTenant(app.db, tenantA, async (tx) => {
      await seedTenant(tx, tenantA);
      const subject = await subjectRepository(tx).create({ tenantId: tenantA, type: 'user' });
      return (await establishSession(tx, tenantA, subject.id, 36_000, ['password'])).sessionId;
    });

    await withTenant(app.db, tenantB, async (tx) => seedTenant(tx, tenantB));

    const rowsFromB = await withTenant(app.db, tenantB, async (tx) =>
      tx.select().from(sessions).where(eq(sessions.id, sessionId)),
    );
    expect(rowsFromB).toEqual([]);

    const rowsFromA = await withTenant(app.db, tenantA, async (tx) =>
      tx.select().from(sessions).where(eq(sessions.id, sessionId)),
    );
    expect(rowsFromA).toHaveLength(1);
  });
});
