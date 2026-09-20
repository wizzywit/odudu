import { createDatabase, MIGRATIONS_DIR, runMigrations, type DatabaseHandle } from '@odudu/db';
import { newId, type Logger } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reap, type ReapOutcome, type RetentionPolicy } from '#/cli/reap';
import { startScheduler } from '#/scheduler';

let containerHandle: TestDatabase | undefined;
let ownerHandle: DatabaseHandle | undefined;
let appHandle: DatabaseHandle | undefined;

let container: TestDatabase;
let owner: DatabaseHandle;
let appDb: DatabaseHandle;

const NOW = new Date('2026-06-01T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

const POLICY: RetentionPolicy = {
  grantSeconds: 7 * 24 * 60 * 60,
  offlineGrantSeconds: 30 * 24 * 60 * 60,
  authorizationCodeSeconds: 60 * 60,
  authenticationSessionSeconds: 60 * 60,
  actionTokenSeconds: 7 * 24 * 60 * 60,
  registrationTokenSeconds: 7 * 24 * 60 * 60,
  sessionSeconds: 24 * 60 * 60,
  emailSentSeconds: 7 * 24 * 60 * 60,
  emailFailedSeconds: 30 * 24 * 60 * 60,
  emailMaxAttempts: 5,
  logoutDeliveredSeconds: 7 * 24 * 60 * 60,
  logoutFailedSeconds: 30 * 24 * 60 * 60,
};

const REAPABLE_TOKENS = 3;

const silent: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silent,
};

async function seedReapableRealm(): Promise<string> {
  const realmId = newId();
  const subjectId = newId();

  await owner.db.execute(sql`
    INSERT INTO realms (id, name) VALUES (${realmId}, ${`sched-${realmId}`})
  `);
  await owner.db.execute(sql`
    INSERT INTO subjects (id, realm_id, type) VALUES (${subjectId}, ${realmId}, 'user')
  `);
  for (let index = 0; index < REAPABLE_TOKENS; index += 1) {
    await owner.db.execute(sql`
      INSERT INTO action_tokens (id, realm_id, subject_id, type, token_hash, expires_at)
      VALUES (${newId()}, ${realmId}, ${subjectId}, 'verify_email', ${newId()},
              ${new Date(NOW.getTime() - 8 * DAY).toISOString()}::timestamptz)
    `);
  }
  return realmId;
}

async function actionTokensLeft(realmId: string): Promise<number> {
  const rows = await owner.db.execute<{ n: string }>(
    sql`SELECT count(*) AS n FROM action_tokens WHERE realm_id = ${realmId}`,
  );
  return Number(rows[0]?.n ?? '-1');
}

beforeAll(async () => {
  containerHandle = await startTestDatabase();
  container = containerHandle;

  ownerHandle = createDatabase(container.adminUrl);
  owner = ownerHandle;
  await runMigrations(owner.db, MIGRATIONS_DIR);

  appHandle = createDatabase(await createAppRole(container.adminUrl), { max: 5 });
  appDb = appHandle;
}, 120_000);

afterAll(async () => {
  await appHandle?.close();
  await ownerHandle?.close();
  await containerHandle?.stop();
});

describe('two servers reaping on their own schedules', () => {
  // The lock lives in the pass, not in the loop
  // (`withEachRealmExclusive`), so what is at stake here is whether the
  // loop reaches it: one tick of two schedulers against one database must
  // delete each row once and no more. Counted in rows rather than read out
  // of `pg_locks`, because the property is that the work happened once.
  it('delete each expired row once between them, not once each', async () => {
    const realmId = await seedReapableRealm();

    const passes: Promise<ReapOutcome>[] = [];
    let entered = 0;
    let openTheGate = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      openTheGate = resolve;
    });

    // Both loops are held until both have ticked, so the pass that loses
    // the lock is attempting it inside the winner's transaction rather
    // than after it committed — which is the only arrangement where a
    // missing lock shows up as a difference.
    const run = (): Promise<void> => {
      const pass = (async () => {
        entered += 1;
        if (entered === 2) openTheGate();
        await gate;
        return reap({ database: appDb, ownerDatabase: owner }, NOW, POLICY);
      })();
      passes.push(pass);
      return pass.then(() => undefined);
    };

    const options = { intervalMs: 25, jitterMs: 0, random: () => 0, log: silent, run };
    const first = startScheduler(options);
    const second = startScheduler(options);

    await gate;
    const stopping = [first.stop(), second.stop()];
    const outcomes = await Promise.all(passes);
    await Promise.all(stopping);

    expect(outcomes).toHaveLength(2);
    const ranOutcomes = outcomes.filter((outcome) => outcome.ran);
    expect(ranOutcomes).toHaveLength(1);
    expect(outcomes.filter((outcome) => !outcome.ran)).toEqual([
      { ran: false, reason: 'another instance holds the retention lock' },
    ]);

    const deleted = outcomes.reduce(
      (total, outcome) => total + (outcome.ran ? outcome.deleted.action_tokens : 0),
      0,
    );
    expect(deleted).toBe(REAPABLE_TOKENS);
    expect(await actionTokensLeft(realmId)).toBe(0);
  });
});
