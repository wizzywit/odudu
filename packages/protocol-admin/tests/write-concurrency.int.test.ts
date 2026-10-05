import { signingKeys } from '@odudu/crypto';
import { withTenant } from '@odudu/db';
import { groupRepository } from '@odudu/domain-authz';
import { authenticationExecutions } from '@odudu/authn-flows';
import { newId } from '@odudu/kernel';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';
import { amendGroup } from '#/usecase/groups';
import { replaceFlow } from '#/usecase/flow';
import { retireKey } from '#/usecase/keys';
import { putSmtp } from '#/usecase/smtp';

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
          ifMatch: '*',
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
          ifMatch: '*',
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
      const outcome = await retireKey(
        tx,
        { audit: AUDIT },
        { keyId: firstKeyId, ifMatch: undefined, ...ACTOR },
      );
      held.arrive();
      await held.open;
      return outcome;
    });

    await held.reached;
    const second = withTenant(fixture.app.db, t.id, (tx) =>
      retireKey(tx, { audit: AUDIT }, { keyId: secondKeyId, ifMatch: undefined, ...ACTOR }),
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

describe('two concurrent first SMTP writes under the empty configuration\u2019s ETag', () => {
  // With no row, there is nothing for a row lock to hold, so both would
  // compare against the empty configuration and both would win.
  it('lets the first win and refuses the second as stale', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const empty = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/smtp`,
      headers: { authorization: `Bearer ${await fixture.adminToken(t.name, ['manage-tenant'])}` },
    });
    const etag = empty.headers.etag;
    if (typeof etag !== 'string') throw new Error('no ETag on the empty configuration');
    const write = (host: string) => ({
      tenantId: t.id,
      ifMatch: etag,
      host,
      port: 587,
      fromAddress: 'noreply@example.test',
      username: null,
      password: { kind: 'keep' } as const,
      starttls: false,
      ...ACTOR,
    });
    const deps = { audit: AUDIT, kek: Buffer.alloc(32, 7), deploymentSmtp: false };
    const held = gate();

    const first = withTenant(fixture.app.db, t.id, async (tx) => {
      const outcome = await putSmtp(tx, deps, write('first.example.test'));
      held.arrive();
      await held.open;
      return outcome;
    });

    await held.reached;
    const second = withTenant(fixture.app.db, t.id, (tx) =>
      putSmtp(tx, deps, write('second.example.test')),
    );

    await awaitBlockedTransaction();
    held.release();

    expect((await first).kind).toBe('ok');
    expect((await second).kind).toBe('precondition_failed');
  });
});

describe('a group reparented while a sibling takes its name under the new parent', () => {
  // The name check before the write sees no sibling; a trigger holds the
  // update on an advisory lock until the sibling has committed, so the
  // unique index, not the check, is what refuses the rewrite.
  it('answers name_taken, writes no audit row and keeps the description', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { moving, finance } = await withTenant(fixture.app.db, t.id, async (tx) => {
      const repo = groupRepository(tx);
      const eng = await repo.create({ tenantId: t.id, name: 'eng', parentId: null });
      const ops = await repo.create({
        tenantId: t.id,
        name: 'ops',
        parentId: eng.id,
        description: 'before',
      });
      const fin = await repo.create({ tenantId: t.id, name: 'finance', parentId: null });
      return { moving: ops.id, finance: fin.id };
    });
    const lockKey = 7_731_001;
    const fn = `hold_${moving.replaceAll('-', '')}`;
    await fixture.owner.db.execute(
      sql.raw(`create function ${fn}() returns trigger language plpgsql as $$
        begin perform pg_advisory_xact_lock(${lockKey}); return new; end $$`),
    );
    await fixture.owner.db.execute(
      sql.raw(`create trigger ${fn} before update on groups for each row
        when (old.id = '${moving}') execute function ${fn}()`),
    );

    try {
      const held = gate();
      const sibling = withTenant(fixture.app.db, t.id, async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${lockKey})`);
        held.arrive();
        await held.open;
        await groupRepository(tx).create({ tenantId: t.id, name: 'ops', parentId: finance });
      });
      await held.reached;

      let audited = 0;
      const amend = withTenant(fixture.app.db, t.id, (tx) =>
        amendGroup(
          tx,
          {
            audit: () => {
              audited += 1;
              return Promise.resolve();
            },
          },
          {
            groupId: moving,
            values: { parent_id: finance, description: 'after' },
            ifMatch: '*',
            callerCapabilities: new Set(['tenant-admin']),
            ...ACTOR,
          },
        ),
      );
      await awaitBlockedTransaction();
      held.release();
      await sibling;

      expect(await amend).toEqual({ kind: 'name_taken', name: 'ops' });
      expect(audited).toBe(0);
      const after = await withTenant(fixture.app.db, t.id, (tx) =>
        groupRepository(tx).byId(moving),
      );
      expect(after).toMatchObject({ path: '/eng/ops', description: 'before' });
    } finally {
      await fixture.owner.db.execute(sql.raw(`drop trigger ${fn} on groups`));
      await fixture.owner.db.execute(sql.raw(`drop function ${fn}()`));
    }
  });
});
