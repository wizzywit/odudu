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
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clientScopeRepository } from '#/repository/client-scopes';
import { consentRepository } from '#/repository/consents';
import { clients } from '#/schema/clients';
import { clientScopes } from '#/schema/client-scopes';

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

async function seedTenant(tx: TenantScopedDatabase, tenantId: string): Promise<void> {
  await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
}

async function insertClient(tx: TenantScopedDatabase, tenantId: string): Promise<string> {
  const clientId = newId();
  await tx.insert(clients).values({
    id: clientId,
    tenantId,
    clientId: `client-${clientId}`,
    name: 'A client',
    type: 'public',
    secretHash: null,
  });
  return clientId;
}

// domain-tenant may not depend on domain-identity, so `subjects` is written
// through raw SQL rather than an imported schema table — the same reason
// consents.ts's own FKs to it are hand-authored SQL rather than declared on
// the drizzle table.
async function insertSubject(tx: TenantScopedDatabase, tenantId: string): Promise<string> {
  const subjectId = newId();
  await tx.execute(
    sql`insert into subjects (id, tenant_id, type) values (${subjectId}, ${tenantId}, 'user')`,
  );
  return subjectId;
}

interface Fixture {
  tenantId: string;
  subjectId: string;
  clientId: string;
  scopeAId: string;
  scopeBId: string;
}

async function seedFixture(): Promise<Fixture> {
  const tenantId = newId();
  return withTenant(app.db, tenantId, async (tx) => {
    await seedTenant(tx, tenantId);
    const subjectId = await insertSubject(tx, tenantId);
    const clientId = await insertClient(tx, tenantId);
    const scopeA = await clientScopeRepository(tx).create({ tenantId, name: 'openid' });
    const scopeB = await clientScopeRepository(tx).create({ tenantId, name: 'profile' });
    return { tenantId, subjectId, clientId, scopeAId: scopeA.id, scopeBId: scopeB.id };
  });
}

describe('grantedScopeIds', () => {
  it('yields an empty set for an unrecorded pair', async () => {
    const { tenantId, subjectId, clientId } = await seedFixture();

    const granted = await withTenant(app.db, tenantId, (tx) =>
      consentRepository(tx).grantedScopeIds(tenantId, subjectId, clientId),
    );

    expect(granted).toEqual(new Set());
  });

  it('does not read another tenant’s granted scopes, even given that tenant’s own id', async () => {
    await expectCrossTenantMethodProbe(app.db, {
      seed: async (tx, tenantId) => {
        await seedTenant(tx, tenantId);
        const subjectId = await insertSubject(tx, tenantId);
        const clientId = await insertClient(tx, tenantId);
        const scope = await clientScopeRepository(tx).create({ tenantId, name: 'openid' });
        await consentRepository(tx).record(tenantId, subjectId, clientId, [scope.id]);
        return { tenantId, subjectId, clientId, scopeId: scope.id };
      },
      verifySeeded: async (tx, seeded) => {
        const granted = await consentRepository(tx).grantedScopeIds(
          seeded.tenantId,
          seeded.subjectId,
          seeded.clientId,
        );
        expect(granted).toEqual(new Set([seeded.scopeId]));
      },
      attempt: async (tx, seeded) =>
        consentRepository(tx).grantedScopeIds(seeded.tenantId, seeded.subjectId, seeded.clientId),
      expectBlocked: (result) => {
        expect(result).toEqual(new Set());
      },
    });
  });
});

describe('record', () => {
  it('round-trips the granted set through grantedScopeIds', async () => {
    const fixture = await seedFixture();

    await withTenant(app.db, fixture.tenantId, (tx) =>
      consentRepository(tx).record(fixture.tenantId, fixture.subjectId, fixture.clientId, [
        fixture.scopeAId,
        fixture.scopeBId,
      ]),
    );

    const granted = await withTenant(app.db, fixture.tenantId, (tx) =>
      consentRepository(tx).grantedScopeIds(fixture.tenantId, fixture.subjectId, fixture.clientId),
    );

    expect(granted).toEqual(new Set([fixture.scopeAId, fixture.scopeBId]));
  });

  // A second call that only ever widens the set would pass against a merge
  // implementation too — asserting the dropped scope is actually gone is
  // what tells "replace" from "merge" apart, which is the property this
  // method exists to guarantee.
  it('drops a scope omitted from a narrower second call', async () => {
    const fixture = await seedFixture();
    await withTenant(app.db, fixture.tenantId, (tx) =>
      consentRepository(tx).record(fixture.tenantId, fixture.subjectId, fixture.clientId, [
        fixture.scopeAId,
        fixture.scopeBId,
      ]),
    );

    await withTenant(app.db, fixture.tenantId, (tx) =>
      consentRepository(tx).record(fixture.tenantId, fixture.subjectId, fixture.clientId, [
        fixture.scopeAId,
      ]),
    );

    const granted = await withTenant(app.db, fixture.tenantId, (tx) =>
      consentRepository(tx).grantedScopeIds(fixture.tenantId, fixture.subjectId, fixture.clientId),
    );

    expect(granted).toEqual(new Set([fixture.scopeAId]));
  });

  it('withdraws consent to a scope whose client_scopes row is deleted', async () => {
    const fixture = await seedFixture();
    await withTenant(app.db, fixture.tenantId, (tx) =>
      consentRepository(tx).record(fixture.tenantId, fixture.subjectId, fixture.clientId, [
        fixture.scopeAId,
        fixture.scopeBId,
      ]),
    );

    await owner.db.delete(clientScopes).where(eq(clientScopes.id, fixture.scopeAId));

    const granted = await withTenant(app.db, fixture.tenantId, (tx) =>
      consentRepository(tx).grantedScopeIds(fixture.tenantId, fixture.subjectId, fixture.clientId),
    );

    expect(granted).toEqual(new Set([fixture.scopeBId]));
  });

  // Not expectCrossTenantMethodProbe: verified (by running it) that
  // postgres.js's sql.begin() rejects the whole transaction the moment any
  // query on it errors, even one caught inside the callback — so this
  // asserts the rejection directly, like assignOrUpdate's "refuses a client
  // from another tenant" test above. `record` is called with tenant A's own
  // ids while bound to tenant B: an app-level tenantId check would let this
  // write through, but the policy's USING doubles as the INSERT's WITH
  // CHECK and refuses the mismatched row.
  it('does not record a consent against another tenant’s pair, even given that tenant’s own id', async () => {
    const tenantA = newId();
    const tenantB = newId();

    const seeded = await withTenant(app.db, tenantA, async (tx) => {
      await seedTenant(tx, tenantA);
      const subjectId = await insertSubject(tx, tenantA);
      const clientId = await insertClient(tx, tenantA);
      const scope = await clientScopeRepository(tx).create({ tenantId: tenantA, name: 'openid' });
      await consentRepository(tx).record(tenantA, subjectId, clientId, [scope.id]);
      return { subjectId, clientId, scopeId: scope.id };
    });

    await withTenant(app.db, tenantB, (tx) => seedTenant(tx, tenantB));

    await expect(
      withTenant(app.db, tenantB, (tx) =>
        consentRepository(tx).record(tenantA, seeded.subjectId, seeded.clientId, []),
      ),
    ).rejects.toThrow();

    const granted = await withTenant(app.db, tenantA, (tx) =>
      consentRepository(tx).grantedScopeIds(tenantA, seeded.subjectId, seeded.clientId),
    );
    expect(granted).toEqual(new Set([seeded.scopeId]));
  });
});
