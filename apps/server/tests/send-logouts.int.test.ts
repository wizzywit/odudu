import {
  createDatabase,
  MIGRATIONS_DIR,
  tenants,
  runMigrations,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { clients } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { logoutDeliveryRepository, type LogoutDeliveryTransport } from '@odudu/protocol-oidc';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  sendLogoutsAcrossTenants,
  sendLogoutsCommand,
  type LogoutSenderOptions,
} from '#/cli/send-logouts';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let appConnectionUrl: string;

const NOW = new Date('2026-06-01T12:00:00.000Z');
const KEK = Buffer.alloc(32, 7).toString('base64');

const OPTIONS: LogoutSenderOptions = { batchSize: 10, leaseSeconds: 30, responseTimeoutMs: 1000 };

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  container = containerHandle;

  ownerHandle = createDatabase(container.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);

  appConnectionUrl = await createAppRole(container.adminUrl);
  appHandle = createDatabase(appConnectionUrl, { max: 5 });
  app = appHandle;
}, 120_000);

afterAll(async () => {
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

async function seedTenant(): Promise<string> {
  const id = newId();
  await owner.db.insert(tenants).values({ id, name: `send-logouts-${id}` });
  return id;
}

// The FK `backchannel_logout_deliveries_client_fk` points at `clients`, so
// a delivery needs a real row there even though it carries no FK to
// `sessions` (packages/protocol-oidc/src/schema/logout-deliveries.ts).
async function seedClient(tenantId: string): Promise<string> {
  const id = newId();
  await owner.db.insert(clients).values({
    id,
    tenantId,
    clientId: `rp-${id}`,
    name: 'Relying party',
    type: 'public',
  });
  return id;
}

async function seedDueDelivery(tenantId: string, endpoint: string): Promise<string> {
  const id = newId();
  const clientId = await seedClient(tenantId);
  await withTenant(app.db, tenantId, (tx) =>
    logoutDeliveryRepository(tx).enqueue([
      {
        id,
        tenantId,
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

describe('sendLogoutsAcrossTenants', () => {
  // Runs first, deliberately, before any other test in this file seeds a
  // tenant: this is the only point at which the shared database is still
  // empty, which is what the "no tenant" branch needs to be reachable at
  // all without paying for a second container.
  it('reports no tenant rather than a report of zeros against an empty database', async () => {
    const report = await sendLogoutsAcrossTenants(
      { database: app, ownerDatabase: owner, transport: respondingWith(200) },
      NOW,
      OPTIONS,
    );

    expect(report).toEqual({ ran: false, reason: 'no tenant was enumerated' });
  });

  it('drains due deliveries across every tenant, not only the first', async () => {
    const tenantA = await seedTenant();
    const tenantB = await seedTenant();
    const idA = await seedDueDelivery(tenantA, 'https://rp-a.example/backchannel');
    const idB = await seedDueDelivery(tenantB, 'https://rp-b.example/backchannel');

    const report = await sendLogoutsAcrossTenants(
      { database: app, ownerDatabase: owner, transport: respondingWith(200) },
      NOW,
      OPTIONS,
    );

    expect(report).toEqual({ ran: true, delivered: 2, failed: 0 });

    // A delivered row is never claimable again — its absence here,
    // combined with the count above, is what proves the write landed.
    const claimableIn = async (tenantId: string): Promise<readonly string[]> =>
      withTenant(app.db, tenantId, (tx) =>
        logoutDeliveryRepository(tx)
          .claimDue({ now: NOW, limit: 10, leaseSeconds: 1 })
          .then((rows) => rows.map((row) => row.id)),
      );

    expect(await claimableIn(tenantA)).not.toContain(idA);
    expect(await claimableIn(tenantB)).not.toContain(idB);
  });

  // Tenants are visited in `tenants.id` order, which is not the order they
  // were created in, so this does not assume which of the two tenants the
  // first transport call lands on — only that both are visited regardless.
  // If a tenant's failure stopped the walk, the other tenant's due delivery
  // would never be claimed and the report would show one call, not two.
  it('counts a failed delivery without letting it stop the rest of the pass', async () => {
    const tenantC = await seedTenant();
    const tenantD = await seedTenant();
    await seedDueDelivery(tenantC, 'https://rp-c.example/backchannel');
    await seedDueDelivery(tenantD, 'https://rp-d.example/backchannel');

    let calls = 0;
    const transport: LogoutDeliveryTransport = () => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new Error('connection refused'))
        : Promise.resolve({ status: 200 });
    };

    const report = await sendLogoutsAcrossTenants(
      { database: app, ownerDatabase: owner, transport },
      NOW,
      OPTIONS,
    );

    expect(report).toEqual({ ran: true, delivered: 1, failed: 1 });
    expect(calls).toBe(2);
  });

  it('refuses to run on a serving connection that bypasses row-level security', async () => {
    await expect(
      sendLogoutsAcrossTenants(
        { database: owner, ownerDatabase: owner, transport: respondingWith(200) },
        NOW,
        OPTIONS,
      ),
    ).rejects.toMatchObject({ code: 'logout_sender_serving_role_bypasses_rls' });
  });
}, 60_000);

async function lastErrorFor(id: string): Promise<string | null> {
  const rows = await owner.db.execute<{ last_error: string | null }>(
    sql`SELECT last_error FROM backchannel_logout_deliveries WHERE id = ${id}`,
  );
  return rows[0]?.last_error ?? null;
}

// `sendLogoutsCommand` is what `odudu send-logouts` and the server's own
// schedule actually call — unlike `sendLogoutsAcrossTenants` above, it
// builds its own transport from `loadConfig()`, which is the only place
// `ODUDU_ALLOW_PRIVATE_CLIENT_URLS` can reach it from.
describe('the transport the command builds from configuration', () => {
  afterEach(() => {
    delete process.env.ODUDU_DATABASE_URL;
    delete process.env.ODUDU_APP_DATABASE_URL;
    delete process.env.ODUDU_KEK;
    delete process.env.ODUDU_ALLOW_PRIVATE_CLIENT_URLS;
  });

  // A private (RFC 1918), not loopback, address: `assertPublicIPv4`
  // (packages/protocol-oidc/src/service/remote-address.ts) throws for
  // loopback unconditionally, before `allowPrivate` is even read, so a
  // loopback endpoint cannot tell this flag's default apart from it being
  // on — see the next test. Private-range refusal is the branch the flag
  // actually gates.
  it('refuses a private backchannel_logout_uri by default', async () => {
    const tenantId = await seedTenant();
    const id = await seedDueDelivery(tenantId, 'https://10.255.255.1:9443/backchannel');

    process.env.ODUDU_DATABASE_URL = container.adminUrl;
    process.env.ODUDU_APP_DATABASE_URL = appConnectionUrl;
    process.env.ODUDU_KEK = KEK;

    // Not an exact count: `sendLogoutsCommand` walks every tenant in the
    // shared test database, including due deliveries earlier tests in
    // this file left behind against unreachable hostnames. This row's own
    // `last_error` is what proves the refusal, not the report's total.
    const report = await sendLogoutsCommand();

    if (!report.ran) throw new Error('expected the pass to run');
    expect(report.delivered).toBe(0);
    expect(await lastErrorFor(id)).toMatch(/private address/u);
  });

  // Not a case the flag can fix: this is `assertPublicIPv4`'s own
  // unconditional loopback refusal, ahead of the `allowPrivate` read.
  it('refuses a loopback backchannel_logout_uri even with the flag on', async () => {
    const tenantId = await seedTenant();
    const id = await seedDueDelivery(tenantId, 'https://127.0.0.1:9443/backchannel');

    process.env.ODUDU_DATABASE_URL = container.adminUrl;
    process.env.ODUDU_APP_DATABASE_URL = appConnectionUrl;
    process.env.ODUDU_KEK = KEK;
    process.env.ODUDU_ALLOW_PRIVATE_CLIENT_URLS = 'true';

    const report = await sendLogoutsCommand();

    if (!report.ran) throw new Error('expected the pass to run');
    expect(report.delivered).toBe(0);
    expect(await lastErrorFor(id)).toMatch(/loopback address/u);
  });
}, 60_000);
