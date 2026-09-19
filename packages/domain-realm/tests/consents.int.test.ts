import {
  createDatabase,
  MIGRATIONS_DIR,
  realms,
  runMigrations,
  withRealm,
  type DatabaseHandle,
  type RealmScopedDatabase,
} from '@odudu/db';
import { expectCrossRealmMethodProbe } from '@odudu/db/testing';
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

async function seedRealm(tx: RealmScopedDatabase, realmId: string): Promise<void> {
  await tx.insert(realms).values({ id: realmId, name: `realm-${realmId}` });
}

async function insertClient(tx: RealmScopedDatabase, realmId: string): Promise<string> {
  const clientId = newId();
  await tx.insert(clients).values({
    id: clientId,
    realmId,
    clientId: `client-${clientId}`,
    name: 'A client',
    type: 'public',
    secretHash: null,
  });
  return clientId;
}

// domain-realm may not depend on domain-identity, so `subjects` is written
// through raw SQL rather than an imported schema table — the same reason
// consents.ts's own FKs to it are hand-authored SQL rather than declared on
// the drizzle table.
async function insertSubject(tx: RealmScopedDatabase, realmId: string): Promise<string> {
  const subjectId = newId();
  await tx.execute(
    sql`insert into subjects (id, realm_id, type) values (${subjectId}, ${realmId}, 'user')`,
  );
  return subjectId;
}

interface Fixture {
  realmId: string;
  subjectId: string;
  clientId: string;
  scopeAId: string;
  scopeBId: string;
}

async function seedFixture(): Promise<Fixture> {
  const realmId = newId();
  return withRealm(app.db, realmId, async (tx) => {
    await seedRealm(tx, realmId);
    const subjectId = await insertSubject(tx, realmId);
    const clientId = await insertClient(tx, realmId);
    const scopeA = await clientScopeRepository(tx).create({ realmId, name: 'openid' });
    const scopeB = await clientScopeRepository(tx).create({ realmId, name: 'profile' });
    return { realmId, subjectId, clientId, scopeAId: scopeA.id, scopeBId: scopeB.id };
  });
}

describe('grantedScopeIds', () => {
  it('yields an empty set for an unrecorded pair', async () => {
    const { realmId, subjectId, clientId } = await seedFixture();

    const granted = await withRealm(app.db, realmId, (tx) =>
      consentRepository(tx).grantedScopeIds(realmId, subjectId, clientId),
    );

    expect(granted).toEqual(new Set());
  });

  it('does not read another realm’s granted scopes, even given that realm’s own id', async () => {
    await expectCrossRealmMethodProbe(app.db, {
      seed: async (tx, realmId) => {
        await seedRealm(tx, realmId);
        const subjectId = await insertSubject(tx, realmId);
        const clientId = await insertClient(tx, realmId);
        const scope = await clientScopeRepository(tx).create({ realmId, name: 'openid' });
        await consentRepository(tx).record(realmId, subjectId, clientId, [scope.id]);
        return { realmId, subjectId, clientId, scopeId: scope.id };
      },
      verifySeeded: async (tx, seeded) => {
        const granted = await consentRepository(tx).grantedScopeIds(
          seeded.realmId,
          seeded.subjectId,
          seeded.clientId,
        );
        expect(granted).toEqual(new Set([seeded.scopeId]));
      },
      attempt: async (tx, seeded) =>
        consentRepository(tx).grantedScopeIds(seeded.realmId, seeded.subjectId, seeded.clientId),
      expectBlocked: (result) => {
        expect(result).toEqual(new Set());
      },
    });
  });
});

describe('record', () => {
  it('round-trips the granted set through grantedScopeIds', async () => {
    const fixture = await seedFixture();

    await withRealm(app.db, fixture.realmId, (tx) =>
      consentRepository(tx).record(fixture.realmId, fixture.subjectId, fixture.clientId, [
        fixture.scopeAId,
        fixture.scopeBId,
      ]),
    );

    const granted = await withRealm(app.db, fixture.realmId, (tx) =>
      consentRepository(tx).grantedScopeIds(fixture.realmId, fixture.subjectId, fixture.clientId),
    );

    expect(granted).toEqual(new Set([fixture.scopeAId, fixture.scopeBId]));
  });

  // A second call that only ever widens the set would pass against a merge
  // implementation too — asserting the dropped scope is actually gone is
  // what tells "replace" from "merge" apart, which is the property this
  // method exists to guarantee.
  it('drops a scope omitted from a narrower second call', async () => {
    const fixture = await seedFixture();
    await withRealm(app.db, fixture.realmId, (tx) =>
      consentRepository(tx).record(fixture.realmId, fixture.subjectId, fixture.clientId, [
        fixture.scopeAId,
        fixture.scopeBId,
      ]),
    );

    await withRealm(app.db, fixture.realmId, (tx) =>
      consentRepository(tx).record(fixture.realmId, fixture.subjectId, fixture.clientId, [
        fixture.scopeAId,
      ]),
    );

    const granted = await withRealm(app.db, fixture.realmId, (tx) =>
      consentRepository(tx).grantedScopeIds(fixture.realmId, fixture.subjectId, fixture.clientId),
    );

    expect(granted).toEqual(new Set([fixture.scopeAId]));
  });

  it('withdraws consent to a scope whose client_scopes row is deleted', async () => {
    const fixture = await seedFixture();
    await withRealm(app.db, fixture.realmId, (tx) =>
      consentRepository(tx).record(fixture.realmId, fixture.subjectId, fixture.clientId, [
        fixture.scopeAId,
        fixture.scopeBId,
      ]),
    );

    await owner.db.delete(clientScopes).where(eq(clientScopes.id, fixture.scopeAId));

    const granted = await withRealm(app.db, fixture.realmId, (tx) =>
      consentRepository(tx).grantedScopeIds(fixture.realmId, fixture.subjectId, fixture.clientId),
    );

    expect(granted).toEqual(new Set([fixture.scopeBId]));
  });

  // Not expectCrossRealmMethodProbe: verified (by running it) that
  // postgres.js's sql.begin() rejects the whole transaction the moment any
  // query on it errors, even one caught inside the callback — so this
  // asserts the rejection directly, like assignOrUpdate's "refuses a client
  // from another realm" test above. `record` is called with realm A's own
  // ids while bound to realm B: an app-level realmId check would let this
  // write through, but the policy's USING doubles as the INSERT's WITH
  // CHECK and refuses the mismatched row.
  it('does not record a consent against another realm’s pair, even given that realm’s own id', async () => {
    const realmA = newId();
    const realmB = newId();

    const seeded = await withRealm(app.db, realmA, async (tx) => {
      await seedRealm(tx, realmA);
      const subjectId = await insertSubject(tx, realmA);
      const clientId = await insertClient(tx, realmA);
      const scope = await clientScopeRepository(tx).create({ realmId: realmA, name: 'openid' });
      await consentRepository(tx).record(realmA, subjectId, clientId, [scope.id]);
      return { subjectId, clientId, scopeId: scope.id };
    });

    await withRealm(app.db, realmB, (tx) => seedRealm(tx, realmB));

    await expect(
      withRealm(app.db, realmB, (tx) =>
        consentRepository(tx).record(realmA, seeded.subjectId, seeded.clientId, []),
      ),
    ).rejects.toThrow();

    const granted = await withRealm(app.db, realmA, (tx) =>
      consentRepository(tx).grantedScopeIds(realmA, seeded.subjectId, seeded.clientId),
    );
    expect(granted).toEqual(new Set([seeded.scopeId]));
  });
});
