import { signingKeys } from '@odudu/crypto';
import { withTenant } from '@odudu/db';
import { authenticationExecutions } from '@odudu/authn-flows';
import { newId } from '@odudu/kernel';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';
import { replaceFlow } from '#/usecase/flow';
import { retireKey } from '#/usecase/keys';

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

const AUDIT = (): Promise<void> => Promise.resolve();
const ACTOR = {
  actorSubjectId: 'first',
  actorTenantId: 'test-tenant',
  actorClientId: 'test-client',
};

interface Gate {
  readonly reached: Promise<void>;
  readonly open: Promise<void>;
  arrive(): void;
  release(): void;
}

function gate(): Gate {
  let arrive = (): void => undefined;
  let release = (): void => undefined;
  const reached = new Promise<void>((resolve) => {
    arrive = resolve;
  });
  const open = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { reached, open, arrive, release };
}

interface WaitingRow {
  waiting: number;
}

async function waitingLocks(): Promise<number> {
  const rows = await fixture.owner.db.execute(
    sql`select count(*)::int as waiting from pg_locks where not granted`,
  );
  return (rows as unknown as WaitingRow[])[0]?.waiting ?? 0;
}

// Returns once a second transaction is genuinely blocked on the first's
// lock, so the two overlap rather than merely following one another — the
// same probe `if-match-concurrency.int.test.ts` uses, and the assertion
// that actually fails when the lock is missing.
async function awaitBlockedTransaction(): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if ((await waitingLocks()) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('no transaction ever blocked; the two writes did not overlap');
}

describe('two concurrent flow replacements against a tenant with no flow', () => {
  // The `FOR UPDATE` inside `replaceForTenant` locks the rows it finds, and
  // a tenant with none has nothing to lock — so without a lock on something
  // else both replacements reach the insert and
  // `authentication_executions_order` refuses one of them.
  it('serialises them instead of colliding on the (tenant, index) constraint', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    await withTenant(fixture.app.db, t.id, (tx) =>
      tx.delete(authenticationExecutions).where(eq(authenticationExecutions.tenantId, t.id)),
    );
    const held = gate();

    const first = withTenant(fixture.app.db, t.id, async (tx) => {
      const outcome = await replaceFlow(
        tx,
        { audit: AUDIT },
        {
          tenantId: t.id,
          steps: [{ authenticator: 'password', requirement: 'required' }],
          ...ACTOR,
        },
      );
      held.arrive();
      await held.open;
      return outcome;
    });

    await held.reached;
    const second = withTenant(fixture.app.db, t.id, (tx) =>
      replaceFlow(
        tx,
        { audit: AUDIT },
        {
          tenantId: t.id,
          steps: [
            { authenticator: 'password', requirement: 'required' },
            { authenticator: 'otp', requirement: 'conditional' },
          ],
          ...ACTOR,
        },
      ),
    );

    await awaitBlockedTransaction();
    held.release();

    expect((await first).kind).toBe('ok');
    expect((await second).kind).toBe('ok');
    const after = await withTenant(fixture.app.db, t.id, (tx) =>
      tx.select().from(authenticationExecutions),
    );
    expect(after.map((row) => row.authenticator).sort()).toEqual(['otp', 'password']);
  });
});

describe('two concurrent retirements of the last two keys for one algorithm', () => {
  // Locking only the target row lets each transaction read the other key as
  // a survivor, so both commit and the tenant is left with no key producing
  // an algorithm a client's userinfo_signed_response_alg still names.
  it('leaves the algorithm produced by at least one key', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const adminToken = await fixture.adminToken(t.name, ['manage-tenant', 'manage-keys']);
    await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/settings`,
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      payload: { client_registration_policy: 'open' },
    });

    const stage = async (): Promise<string> => {
      const res = await fixture.http.inject({
        method: 'POST',
        url: `/admin/tenants/${t.name}/keys`,
        headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
        payload: { alg: 'RS256' },
      });
      return res.json<{ id: string }>().id;
    };
    // Two rotating RS256 keys beside the tenant's own active ES256 one, so
    // either retirement alone is legitimate and only the pair is not.
    const firstKeyId = await stage();
    const secondKeyId = await stage();
    await fixture.registerClientWithUserinfoAlg(t.name, 'RS256');

    const held = gate();
    const first = withTenant(fixture.app.db, t.id, async (tx) => {
      const outcome = await retireKey(tx, { audit: AUDIT }, { keyId: firstKeyId, ...ACTOR });
      held.arrive();
      await held.open;
      return outcome;
    });

    await held.reached;
    const second = withTenant(fixture.app.db, t.id, (tx) =>
      retireKey(tx, { audit: AUDIT }, { keyId: secondKeyId, ...ACTOR }),
    );

    await awaitBlockedTransaction();
    held.release();

    expect((await first).kind).toBe('ok');
    expect((await second).kind).toBe('algorithm_needed');

    const left = await withTenant(fixture.app.db, t.id, (tx) =>
      tx.select().from(signingKeys).where(eq(signingKeys.alg, 'RS256')),
    );
    expect(left.filter((key) => key.status !== 'retired')).toHaveLength(1);
  });
});
