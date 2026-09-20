import {
  createDatabase,
  MIGRATIONS_DIR,
  realms,
  runMigrations,
  withRealm,
  type DatabaseHandle,
} from '@odudu/db';
import { clients } from '@odudu/domain-realm';
import { newId } from '@odudu/kernel';
import { logoutDeliveryRepository, type LogoutDeliveryTransport } from '@odudu/protocol-oidc';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sendLogoutsAcrossRealms, type LogoutSenderOptions } from '#/cli/send-logouts';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

const NOW = new Date('2026-06-01T12:00:00.000Z');

const OPTIONS: LogoutSenderOptions = { batchSize: 10, leaseSeconds: 30, responseTimeoutMs: 1000 };

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

async function seedRealm(): Promise<string> {
  const id = newId();
  await owner.db.insert(realms).values({ id, name: `send-logouts-${id}` });
  return id;
}

// The FK `backchannel_logout_deliveries_client_fk` points at `clients`, so
// a delivery needs a real row there even though it carries no FK to
// `sessions` (packages/protocol-oidc/src/schema/logout-deliveries.ts).
async function seedClient(realmId: string): Promise<string> {
  const id = newId();
  await owner.db.insert(clients).values({
    id,
    realmId,
    clientId: `rp-${id}`,
    name: 'Relying party',
    type: 'public',
  });
  return id;
}

async function seedDueDelivery(realmId: string, endpoint: string): Promise<string> {
  const id = newId();
  const clientId = await seedClient(realmId);
  await withRealm(app.db, realmId, (tx) =>
    logoutDeliveryRepository(tx).enqueue([
      {
        id,
        realmId,
        clientId,
        sessionId: newId(),
        endpoint,
        logoutToken: 'signed-logout-token',
        nextAttemptAt: NOW,
      },
    ]),
  );
  return id;
}

function respondingWith(status: number): LogoutDeliveryTransport {
  return () => Promise.resolve({ status });
}

describe('sendLogoutsAcrossRealms', () => {
  // Runs first, deliberately, before any other test in this file seeds a
  // realm: this is the only point at which the shared database is still
  // empty, which is what the "no realm" branch needs to be reachable at
  // all without paying for a second container.
  it('reports no realm rather than a report of zeros against an empty database', async () => {
    const report = await sendLogoutsAcrossRealms(
      { database: app, ownerDatabase: owner, transport: respondingWith(200) },
      NOW,
      OPTIONS,
    );

    expect(report).toEqual({ ran: false, reason: 'no realm was enumerated' });
  });

  it('drains due deliveries across every realm, not only the first', async () => {
    const realmA = await seedRealm();
    const realmB = await seedRealm();
    const idA = await seedDueDelivery(realmA, 'https://rp-a.example/backchannel');
    const idB = await seedDueDelivery(realmB, 'https://rp-b.example/backchannel');

    const report = await sendLogoutsAcrossRealms(
      { database: app, ownerDatabase: owner, transport: respondingWith(200) },
      NOW,
      OPTIONS,
    );

    expect(report).toEqual({ ran: true, delivered: 2, failed: 0 });

    // A delivered row is never claimable again — its absence here,
    // combined with the count above, is what proves the write landed.
    const claimableIn = async (realmId: string): Promise<readonly string[]> =>
      withRealm(app.db, realmId, (tx) =>
        logoutDeliveryRepository(tx)
          .claimDue({ now: NOW, limit: 10, leaseSeconds: 1 })
          .then((rows) => rows.map((row) => row.id)),
      );

    expect(await claimableIn(realmA)).not.toContain(idA);
    expect(await claimableIn(realmB)).not.toContain(idB);
  });

  // Realms are visited in `realms.id` order, which is not the order they
  // were created in, so this does not assume which of the two realms the
  // first transport call lands on — only that both are visited regardless.
  // If a realm's failure stopped the walk, the other realm's due delivery
  // would never be claimed and the report would show one call, not two.
  it('counts a failed delivery without letting it stop the rest of the pass', async () => {
    const realmC = await seedRealm();
    const realmD = await seedRealm();
    await seedDueDelivery(realmC, 'https://rp-c.example/backchannel');
    await seedDueDelivery(realmD, 'https://rp-d.example/backchannel');

    let calls = 0;
    const transport: LogoutDeliveryTransport = () => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new Error('connection refused'))
        : Promise.resolve({ status: 200 });
    };

    const report = await sendLogoutsAcrossRealms(
      { database: app, ownerDatabase: owner, transport },
      NOW,
      OPTIONS,
    );

    expect(report).toEqual({ ran: true, delivered: 1, failed: 1 });
    expect(calls).toBe(2);
  });

  it('refuses to run on a serving connection that bypasses row-level security', async () => {
    await expect(
      sendLogoutsAcrossRealms(
        { database: owner, ownerDatabase: owner, transport: respondingWith(200) },
        NOW,
        OPTIONS,
      ),
    ).rejects.toMatchObject({ code: 'logout_sender_serving_role_bypasses_rls' });
  });
}, 60_000);
