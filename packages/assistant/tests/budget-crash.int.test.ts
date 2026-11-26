import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ASSISTANT_SETTING_DEFAULTS } from '@odudu/contracts/admin';
import {
  createDatabase,
  MIGRATIONS_DIR,
  runMigrations,
  tenants,
  withTenant,
  type DatabaseHandle,
} from '@odudu/db';
import { newId } from '@odudu/kernel';
import { createAppRole, startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { upkeepBudget } from '#/usecase/budget-upkeep';
import { writeSettings } from '#/usecase/settings';

let container: TestDatabase;
let owner: DatabaseHandle;
let app: DatabaseHandle;
let appUrl: string;

beforeAll(async () => {
  container = await startTestDatabase();
  owner = createDatabase(container.adminUrl);
  await runMigrations(owner.db, MIGRATIONS_DIR);
  appUrl = await createAppRole(container.adminUrl);
  app = createDatabase(appUrl, { max: 4 });
}, 120_000);

afterAll(async () => {
  await app.close();
  await owner.close();
  await container.stop();
});

const SCRIPT = fileURLToPath(new URL('./support/crash-turn.ts', import.meta.url));
const SECOND = 1000;

// Starts the script and resolves with the first line it writes.
function launch(env: Record<string, string>): { child: ChildProcess; first: Promise<string> } {
  const child = spawn(process.execPath, [SCRIPT], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let seen = '';
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const first = new Promise<string>((resolve, reject) => {
    child.stdout.on('data', (chunk: Buffer) => {
      seen += chunk.toString();
      const line = seen.split('\n')[0];
      if (seen.includes('\n') && line !== undefined) resolve(line);
    });
    child.once('exit', () => {
      reject(new Error(`the script ended before it wrote a line: ${stderr.slice(0, 600)}`));
    });
  });
  return { child, first };
}

async function ledger(tenantId: string) {
  return withTenant(app.db, tenantId, async (tx) => {
    const used = await tx.execute<{ scope_kind: string; used: string }>(
      sql`select scope_kind, used::text as used from assistant_budget_counters`,
    );
    const reservations = await tx.execute<{ sent: boolean; settled: boolean; reserved: string }>(
      sql`select sent, settled, reserved::text as reserved from assistant_reservations order by created_at`,
    );
    return {
      used: Object.fromEntries(used.map((row) => [row.scope_kind, Number(row.used)])),
      reservations,
    };
  });
}

describe('a process killed in the middle of a model call', () => {
  it('leaves its tokens counted after the sweep, and repeated crashes cannot pass the limit', async () => {
    const tenantId = newId();
    const subjectId = newId();
    await withTenant(app.db, tenantId, async (tx) => {
      await tx.insert(tenants).values({ id: tenantId, name: `crash-${tenantId.slice(-12)}` });
      await tx.execute(
        sql`insert into subjects (id, tenant_id, type) values (${subjectId}, ${tenantId}, 'user')`,
      );
      // One administrator may spend a quarter of this a day: room for one call, not two.
      await writeSettings(
        tx,
        tenantId,
        { ...ASSISTANT_SETTING_DEFAULTS, assistant_monthly_tokens_standard: 400_000 },
        new Date(),
      );
    });
    const env = {
      CRASH_DATABASE_URL: appUrl,
      CRASH_TENANT: tenantId,
      CRASH_SUBJECT: subjectId,
    };

    const first = launch(env);
    expect(await first.first).toBe('SENT');
    first.child.kill('SIGKILL');
    await new Promise((resolve) => first.child.once('exit', resolve));

    const afterKill = await ledger(tenantId);
    expect(afterKill.reservations).toEqual([
      expect.objectContaining({ sent: true, settled: false }),
    ]);
    const held = afterKill.used.tenant_month ?? 0;
    expect(held).toBeGreaterThan(8192);

    const swept = await withTenant(app.db, tenantId, (tx) =>
      upkeepBudget(tx, new Date(Date.now() + 60 * 60 * SECOND)),
    );
    expect(swept).toMatchObject({ reservationsCharged: 1, reservationsReleased: 0 });
    const afterSweep = await ledger(tenantId);
    expect(afterSweep.reservations).toEqual([expect.objectContaining({ settled: true })]);
    expect(afterSweep.used.tenant_month).toBe(held);
    expect(afterSweep.used.admin_day).toBe(held);

    // A second attempt is refused at the administrator's daily level, because the
    // killed call still counts in full; nothing is spent past the limit.
    const second = launch(env);
    expect(await second.first).toBe('DONE budget_admin');
    second.child.kill('SIGKILL');
    const final = await ledger(tenantId);
    expect(final.used.admin_day).toBe(held);
    expect(final.reservations).toHaveLength(1);
  }, 120_000);

  it('gives back a reservation whose call never reached the provider', async () => {
    const tenantId = newId();
    const windowStart = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();
    await withTenant(app.db, tenantId, async (tx) => {
      await tx.insert(tenants).values({ id: tenantId, name: `crash-${tenantId.slice(-12)}` });
      await tx.execute(sql`
        insert into assistant_budget_counters
          (tenant_id, scope_kind, scope_key, slot, used, limit_tokens, window_start)
        values (${tenantId}, 'tenant_month', ${tenantId}, 'standard', 500, 1000, ${windowStart}::timestamptz)`);
      await tx.execute(sql`
        insert into assistant_reservations
          (tenant_id, id, turn_id, slot, reserved, levels, sent, created_at)
        values (${tenantId}, ${newId()}, ${newId()}, 'standard', 500,
                ${JSON.stringify([
                  {
                    level: 'tenant_month',
                    scopeKey: tenantId,
                    slot: 'standard',
                    windowStart,
                  },
                ])}::jsonb, false, now() - interval '1 hour')`);
    });
    const swept = await withTenant(app.db, tenantId, (tx) => upkeepBudget(tx, new Date()));
    expect(swept).toMatchObject({ reservationsReleased: 1, reservationsCharged: 0 });
    expect((await ledger(tenantId)).used.tenant_month).toBe(0);
  });

  it('resolves a backlog larger than one batch in a single upkeep', async () => {
    const tenantId = newId();
    await withTenant(app.db, tenantId, async (tx) => {
      await tx.insert(tenants).values({ id: tenantId, name: `crash-${tenantId.slice(-12)}` });
      await tx.execute(sql`
        insert into assistant_reservations
          (tenant_id, id, turn_id, slot, reserved, levels, sent, created_at)
        select ${tenantId}, gen_random_uuid(), gen_random_uuid(), 'standard', 1,
               '[{"level":"turn","scopeKey":"none","slot":null,"windowStart":"2026-01-01T00:00:00.000Z"}]'::jsonb,
               n % 2 = 0, now() - interval '1 hour'
          from generate_series(1, 450) n`);
    });
    const swept = await withTenant(app.db, tenantId, (tx) => upkeepBudget(tx, new Date()));
    expect(swept.reservationsReleased + swept.reservationsCharged).toBe(450);
    const open = await withTenant(app.db, tenantId, (tx) =>
      tx.execute<{ n: number }>(
        sql`select count(*)::int as n from assistant_reservations where not settled`,
      ),
    );
    expect(open[0]?.n).toBe(0);
  });
});
