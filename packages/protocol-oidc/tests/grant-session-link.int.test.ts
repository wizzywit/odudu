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
import { sessionRepository, provisionTenant } from '@odudu/authn-flows';
import { clients, provisionClientDefaults } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clientOidcConfigRepository } from '#/repository/client-oidc-config';
import { tokenGrantRepository } from '#/repository/grants';

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

describe('a grant and the session it belongs to', () => {
  it('revokes every grant of one session and leaves an offline grant alone', async () => {
    const tenantId = newId();
    const sessionId = newId();

    const { clientDbId, subjectId } = await withTenant(app.db, tenantId, (tx) =>
      seedTenantClientSubject(tx, tenantId),
    );
    await withTenant(app.db, tenantId, (tx) =>
      sessionRepository(tx).create({
        id: sessionId,
        tenantId,
        subjectId,
        expiresAt: new Date(Date.now() + 3_600_000),
        authenticators: [],
      }),
    );

    const [bound, offline] = await withTenant(app.db, tenantId, async (tx) => {
      const repository = tokenGrantRepository(tx);
      return [
        await repository.create({
          id: newId(),
          tenantId,
          clientId: clientDbId,
          subjectId,
          scope: 'openid',
          audience: [],
          sessionId,
        }),
        await repository.create({
          id: newId(),
          tenantId,
          clientId: clientDbId,
          subjectId,
          scope: 'openid offline_access',
          audience: [],
          sessionId: null,
        }),
      ];
    });

    const revoked = await withTenant(app.db, tenantId, (tx) =>
      tokenGrantRepository(tx).revokeForSession(sessionId, new Date()),
    );
    expect(revoked).toBe(1);

    await withTenant(app.db, tenantId, async (tx) => {
      const repository = tokenGrantRepository(tx);
      expect((await repository.byId(bound.id))?.revokedAt).not.toBeNull();
      expect((await repository.byId(offline.id))?.revokedAt).toBeNull();
      expect((await repository.byId(offline.id))?.sessionId).toBeNull();
    });
  });

  it('cannot revoke a foreign tenant’s session grants', async () => {
    const mineTenantId = newId();
    const theirsTenantId = newId();
    const sessionId = newId();

    await withTenant(app.db, mineTenantId, (tx) => seedTenantClientSubject(tx, mineTenantId));
    const { clientDbId, subjectId } = await withTenant(app.db, theirsTenantId, (tx) =>
      seedTenantClientSubject(tx, theirsTenantId),
    );
    await withTenant(app.db, theirsTenantId, async (tx) => {
      await sessionRepository(tx).create({
        id: sessionId,
        tenantId: theirsTenantId,
        subjectId,
        expiresAt: new Date(Date.now() + 3_600_000),
        authenticators: [],
      });
      await tokenGrantRepository(tx).create({
        id: newId(),
        tenantId: theirsTenantId,
        clientId: clientDbId,
        subjectId,
        scope: 'openid',
        audience: [],
        sessionId,
      });
    });

    const revoked = await withTenant(app.db, mineTenantId, (tx) =>
      tokenGrantRepository(tx).revokeForSession(sessionId, new Date()),
    );
    expect(revoked).toBe(0);
  });

  it('finds every grant of one session and not an offline grant for the same subject', async () => {
    const tenantId = newId();
    const sessionId = newId();

    const { clientDbId, subjectId } = await withTenant(app.db, tenantId, (tx) =>
      seedTenantClientSubject(tx, tenantId),
    );
    await withTenant(app.db, tenantId, (tx) =>
      sessionRepository(tx).create({
        id: sessionId,
        tenantId,
        subjectId,
        expiresAt: new Date(Date.now() + 3_600_000),
        authenticators: [],
      }),
    );

    const [first, second] = await withTenant(app.db, tenantId, async (tx) => {
      const repository = tokenGrantRepository(tx);
      return [
        await repository.create({
          id: newId(),
          tenantId,
          clientId: clientDbId,
          subjectId,
          scope: 'openid',
          audience: [],
          sessionId,
        }),
        await repository.create({
          id: newId(),
          tenantId,
          clientId: clientDbId,
          subjectId,
          scope: 'profile',
          audience: [],
          sessionId,
        }),
      ];
    });
    await withTenant(app.db, tenantId, (tx) =>
      tokenGrantRepository(tx).create({
        id: newId(),
        tenantId,
        clientId: clientDbId,
        subjectId,
        scope: 'openid offline_access',
        audience: [],
        sessionId: null,
      }),
    );

    const found = await withTenant(app.db, tenantId, (tx) =>
      tokenGrantRepository(tx).bySession(sessionId),
    );
    expect(found.map((grant) => grant.id).sort()).toEqual([first.id, second.id].sort());
  });

  it('cannot find a foreign tenant’s session grants', async () => {
    const theirsTenantId = newId();
    const mineTenantId = newId();
    const sessionId = newId();

    await withTenant(app.db, mineTenantId, (tx) => seedTenantClientSubject(tx, mineTenantId));
    const { clientDbId, subjectId } = await withTenant(app.db, theirsTenantId, (tx) =>
      seedTenantClientSubject(tx, theirsTenantId),
    );
    await withTenant(app.db, theirsTenantId, async (tx) => {
      await sessionRepository(tx).create({
        id: sessionId,
        tenantId: theirsTenantId,
        subjectId,
        expiresAt: new Date(Date.now() + 3_600_000),
        authenticators: [],
      });
      await tokenGrantRepository(tx).create({
        id: newId(),
        tenantId: theirsTenantId,
        clientId: clientDbId,
        subjectId,
        scope: 'openid',
        audience: [],
        sessionId,
      });
    });

    const found = await withTenant(app.db, mineTenantId, (tx) =>
      tokenGrantRepository(tx).bySession(sessionId),
    );
    expect(found).toEqual([]);
  });

  it('finds the client behind a session’s grant, joining client_oidc_config', async () => {
    const tenantId = newId();
    const sessionId = newId();

    const { clientDbId, subjectId } = await withTenant(app.db, tenantId, (tx) =>
      seedTenantClientSubject(tx, tenantId),
    );
    await withTenant(app.db, tenantId, async (tx) => {
      await sessionRepository(tx).create({
        id: sessionId,
        tenantId,
        subjectId,
        expiresAt: new Date(Date.now() + 3_600_000),
        authenticators: [],
      });
      await clientOidcConfigRepository(tx).create({
        clientId: clientDbId,
        tenantId,
        redirectUris: ['https://rp.example/callback'],
        grantTypes: ['authorization_code'],
        tokenEndpointAuthMethod: 'client_secret_basic',
        audiences: [],
        accessTokenTtlSeconds: 300,
        refreshTokenTtlSeconds: 1_209_600,
        frontchannelLogoutUri: 'https://rp.example/logout',
      });
      await tokenGrantRepository(tx).create({
        id: newId(),
        tenantId,
        clientId: clientDbId,
        subjectId,
        scope: 'openid',
        audience: [],
        sessionId,
      });
    });

    const found = await withTenant(app.db, tenantId, (tx) =>
      tokenGrantRepository(tx).clientsForSession(sessionId),
    );
    expect(found.map((target) => target.clientId)).toEqual([clientDbId]);
  });

  // Under tenant-scoped access, clientsForSession returns nothing for a
  // foreign tenant's session. It does not, by itself, prove
  // client_oidc_config's or clients' own RLS policies (packages/db/drizzle/
  // 0007_client_oidc_config.sql, 0004_clients.sql) survive the join:
  // token_grants_client_fk ties tenant_id to the same clients row, so a
  // foreign grant's row is already excluded by token_grants' own policy
  // before either join runs, and neither policy is exercised here on its
  // own.
  it('cannot find a foreign tenant’s client behind a session’s grant', async () => {
    const theirsTenantId = newId();
    const mineTenantId = newId();
    const sessionId = newId();

    await withTenant(app.db, mineTenantId, (tx) => seedTenantClientSubject(tx, mineTenantId));
    const { clientDbId, subjectId } = await withTenant(app.db, theirsTenantId, (tx) =>
      seedTenantClientSubject(tx, theirsTenantId),
    );
    await withTenant(app.db, theirsTenantId, async (tx) => {
      await sessionRepository(tx).create({
        id: sessionId,
        tenantId: theirsTenantId,
        subjectId,
        expiresAt: new Date(Date.now() + 3_600_000),
        authenticators: [],
      });
      await clientOidcConfigRepository(tx).create({
        clientId: clientDbId,
        tenantId: theirsTenantId,
        redirectUris: ['https://rp.example/callback'],
        grantTypes: ['authorization_code'],
        tokenEndpointAuthMethod: 'client_secret_basic',
        audiences: [],
        accessTokenTtlSeconds: 300,
        refreshTokenTtlSeconds: 1_209_600,
        frontchannelLogoutUri: 'https://rp.example/logout',
      });
      await tokenGrantRepository(tx).create({
        id: newId(),
        tenantId: theirsTenantId,
        clientId: clientDbId,
        subjectId,
        scope: 'openid',
        audience: [],
        sessionId,
      });
    });

    const found = await withTenant(app.db, mineTenantId, (tx) =>
      tokenGrantRepository(tx).clientsForSession(sessionId),
    );
    expect(found).toEqual([]);
  });
});
