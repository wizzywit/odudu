import {
  createDatabase,
  MIGRATIONS_DIR,
  realms,
  runMigrations,
  withRealm,
  type DatabaseHandle,
} from '@odudu/db';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clientScopeRepository } from '#/repository/client-scopes';
import {
  clientScopeAssignments,
  clientScopes,
  type ClientScopeAssignment,
} from '#/schema/client-scopes';
import { clients } from '#/schema/clients';
import {
  provisionClientDefaults,
  provisionRealmDefaults,
  REALM_DEFAULT_SCOPE_NAMES,
} from '#/usecase/provision-defaults';

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

describe('a newly provisioned client', () => {
  // `offline_access` reaching a token is asserted end to end in
  // packages/protocol-oidc/tests/offline-access.int.test.ts. What matters
  // here — and what nothing else pins — is the assignment *kind* each
  // default scope lands with: P3's consent screen reads that column to
  // tell a pre-approved scope from one it must ask about, so a future
  // change to provisionClientDefaults that quietly assigned everything
  // 'default' again would otherwise pass every existing test silently.
  it("assigns offline_access as 'optional' and every other default scope as 'default'", async () => {
    const realmId = newId();
    const clientDbId = newId();

    const assignmentByName = await withRealm(app.db, realmId, async (tx) => {
      await tx.insert(realms).values({ id: realmId, name: `realm-${realmId}` });
      await provisionRealmDefaults(tx, realmId);
      await tx.insert(clients).values({
        id: clientDbId,
        realmId,
        clientId: `client-${realmId}`,
        name: 'a freshly provisioned client',
        type: 'public',
        secretHash: null,
      });
      await provisionClientDefaults(tx, clientDbId);

      const rows = await tx
        .select({ name: clientScopes.name, assignment: clientScopeAssignments.assignment })
        .from(clientScopeAssignments)
        .innerJoin(clientScopes, eq(clientScopeAssignments.clientScopeId, clientScopes.id))
        .where(eq(clientScopeAssignments.clientId, clientDbId));
      return new Map<string, ClientScopeAssignment>(rows.map((row) => [row.name, row.assignment]));
    });

    expect([...assignmentByName.keys()].sort()).toEqual([...REALM_DEFAULT_SCOPE_NAMES].sort());
    expect(assignmentByName.get('offline_access')).toBe('optional');
    for (const name of REALM_DEFAULT_SCOPE_NAMES) {
      if (name === 'offline_access') continue;
      expect(assignmentByName.get(name), `${name} should be assigned 'default'`).toBe('default');
    }

    // An 'optional' assignment is still an assignment: the client can
    // request the scope and receive it (protocol-oidc's offline-access
    // tests prove that end to end; this is `forClient`'s own read, the
    // thing `resolveScope` intersects the request against).
    const assigned = await withRealm(app.db, realmId, (tx) =>
      clientScopeRepository(tx).forClient(clientDbId),
    );
    expect(assigned.map((scope) => scope.name)).toContain('offline_access');
  });
});
