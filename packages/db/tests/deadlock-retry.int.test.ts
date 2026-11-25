import { startTestDatabase, type TestDatabase } from '@odudu/testkit';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type DatabaseHandle } from '#/client';
import { isDeadlockDetected } from '#/sqlstate';
import { withTenant, withTenantRetrying } from '#/tx';

let container: TestDatabase | undefined;
let handle: DatabaseHandle | undefined;
const TENANT = '0192a0a0-0000-7000-8000-000000000001';

beforeAll(async () => {
  container = await startTestDatabase();
  handle = createDatabase(container.adminUrl, { max: 6 });
}, 120_000);

afterAll(async () => {
  await handle?.close();
  await container?.stop();
});

function db(): DatabaseHandle {
  if (handle === undefined) throw new Error('beforeAll did not run');
  return handle;
}

// Two transactions that take two advisory locks in opposite orders, each
// holding its first until the other has its own: a deadlock PostgreSQL ends by
// aborting one of them.
function ring(
  run: typeof withTenant,
  runs: { first: number; second: number },
  keys: readonly [number, number],
) {
  let arrived = 0;
  let bothHold: () => void = () => undefined;
  const barrier = new Promise<void>((resolve) => {
    bothHold = resolve;
  });
  const side = (own: number, other: number, count: 'first' | 'second') =>
    run(db().db, TENANT, async (tx) => {
      runs[count] += 1;
      await tx.execute(sql`select pg_advisory_xact_lock(${own})`);
      if (runs[count] === 1) {
        arrived += 1;
        if (arrived === 2) bothHold();
        await barrier;
      }
      await tx.execute(sql`select pg_advisory_xact_lock(${other})`);
      return count;
    });
  return [side(keys[0], keys[1], 'first'), side(keys[1], keys[0], 'second')] as const;
}

describe('a transaction that loses a deadlock', () => {
  it('is run again and finishes, where without the retry it fails with 40P01', async () => {
    const bare = { first: 0, second: 0 };
    const results = await Promise.allSettled(ring(withTenant, bare, [9_100, 9_101]));
    const failed = results.flatMap((r) => (r.status === 'rejected' ? [r.reason as unknown] : []));
    expect(failed).toHaveLength(1);
    expect(isDeadlockDetected(failed[0])).toBe(true);

    const runs = { first: 0, second: 0 };
    const retrying: typeof withTenant = (database, tenantId, fn, context) =>
      withTenantRetrying(database, tenantId, fn, context, { pauseMs: () => 0 });
    const done = await Promise.all(ring(retrying, runs, [9_102, 9_103]));
    expect(done.sort()).toEqual(['first', 'second']);
    expect(runs.first + runs.second).toBe(3);
  }, 30_000);
});
