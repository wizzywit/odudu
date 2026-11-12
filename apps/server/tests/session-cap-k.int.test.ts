import {
  admitSession,
  deviceDigest,
  newDeviceId,
  SessionEntry,
  sessionRepository,
  sessions,
  type SessionLifespans,
} from '@odudu/authn-flows';
import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
  type TenantScopedDatabase,
} from '@odudu/db';
import { subjectRepository } from '@odudu/domain-identity';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const CAP = 3;
const TRIALS = 10;
const LIFESPANS: SessionLifespans = {
  ssoSessionIdleSeconds: 1800,
  ssoSessionMaxSeconds: 36_000,
  rememberMeIdleSeconds: 604_800,
  rememberMeMaxSeconds: 2_592_000,
};

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  app = createDatabase(await createAppRole(container.adminUrl), { max: 12 });
}, 120_000);

afterAll(async () => {
  await app.close();
  await owner.close();
  await container.stop();
});

interface Race {
  // Live sessions of the tenant after every racer committed.
  admitted: number;
  // Live sessions that the cookie the last response wrote does not name:
  // the browser keeps one Set-Cookie per name, so it cannot send them back.
  orphaned: number;
}

const DEVICE = deviceDigest(newDeviceId(() => Uint8Array.from({ length: 16 }, (_, i) => i)));

async function seed(
  tenantId: string,
  device: string | null,
): Promise<{ subjectId: string; held: SessionEntry[] }> {
  return withTenant(app.db, tenantId, async (tx: TenantScopedDatabase) => {
    await tx.insert(tenants).values({ id: tenantId, name: `tenant-${tenantId}` });
    const subject = await subjectRepository(tx).create({ tenantId, type: 'user' });
    const held: SessionEntry[] = [];
    for (let i = 0; i < CAP; i++) {
      const entry = SessionEntry.issue(newId());
      await sessionRepository(tx).create({
        id: entry.id,
        tenantId,
        subjectId: subject.id,
        expiresAt: new Date(Date.now() + 3_600_000),
        authenticators: [],
        secretHash: entry.secretHash(),
        deviceId: device,
      });
      held.push(entry);
    }
    return { subjectId: subject.id, held };
  });
}

async function race(k: number, device: string | null): Promise<Race> {
  const tenantId = newId();
  const { subjectId, held } = await seed(tenantId, device);
  const lastResponse: { entries: SessionEntry[] } = { entries: [] };

  await Promise.all(
    Array.from({ length: k }, () =>
      withTenant(app.db, tenantId, async (tx) => {
        const admitted = await admitSession(tx, {
          tenantId,
          subjectId,
          authenticators: [],
          remembered: false,
          browserSessions: held,
          maxSessionsPerBrowser: CAP,
          lifespans: LIFESPANS,
          device,
        });
        // What this racer's response writes, in the order commits land.
        return admitted.entry;
      }).then((entry) => {
        lastResponse.entries = [...held, entry];
      }),
    ),
  );

  return withTenant(app.db, tenantId, async (tx) => {
    const now = new Date();
    const rows = await tx.select().from(sessions).where(eq(sessions.tenantId, tenantId));
    const live = await sessionRepository(tx).liveBySubject(subjectId, LIFESPANS, now);
    const named = new Set(
      (await sessionRepository(tx).liveByEntries(lastResponse.entries, LIFESPANS, now)).map(
        (session) => session.id,
      ),
    );
    expect(rows.length).toBe(CAP + k);
    return { admitted: live.length, orphaned: live.filter((s) => !named.has(s.id)).length };
  });
}

async function measure(device: string | null): Promise<Map<number, Race[]>> {
  const byK = new Map<number, Race[]>();
  for (const k of [2, 3, 4, 6]) {
    const races: Race[] = [];
    for (let trial = 0; trial < TRIALS; trial++) races.push(await race(k, device));
    byK.set(k, races);
  }
  return byK;
}

function line(label: string, byK: Map<number, Race[]>): string {
  return [...byK]
    .map(
      ([k, races]) =>
        `${label} k=${String(k)} admitted=[${races.map((r) => r.admitted).join(',')}] ` +
        `orphaned=[${races.map((r) => r.orphaned).join(',')}]`,
    )
    .join('\n');
}

describe('k concurrent logins at the cap', () => {
  it('admits cap + (k - 1) when only the cookie names the browser', async () => {
    const byK = await measure(null);
    console.info(`MEASURE cap=${String(CAP)}\n${line('cookie-list', byK)}`);
    for (const [k, races] of byK) {
      for (const r of races) {
        expect(r.admitted).toBe(CAP + k - 1);
        expect(r.orphaned).toBe(k - 1);
      }
    }
  }, 120_000);

  it('admits exactly the cap when the device cookie names the browser', async () => {
    const byK = await measure(DEVICE);
    console.info(`MEASURE cap=${String(CAP)}\n${line('device', byK)}`);
    for (const races of byK.values()) {
      for (const r of races) expect(r.admitted).toBe(CAP);
    }
  }, 120_000);
});
