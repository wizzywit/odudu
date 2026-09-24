import { withTenant } from '@odudu/db';
import { newId } from '@odudu/kernel';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { etagOf } from '#/service/etag';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';
import { amendClient, clientWireShape, readClient } from '#/usecase/clients';
import { amendSettings, readSettings } from '#/usecase/settings';

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
// lock, so the two overlap rather than merely following one another. Polling
// Postgres is what makes that observable: nothing in the process under test
// reports that a statement is waiting.
async function awaitBlockedTransaction(): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if ((await waitingLocks()) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('no transaction ever blocked; the two writes did not overlap');
}

describe('two concurrent writes carrying the same If-Match', () => {
  it('lets the first settings amendment win and refuses the second', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const before = await withTenant(fixture.app.db, t.id, (tx) => readSettings(tx, t.id));
    const held = gate();

    const first = withTenant(fixture.app.db, t.id, async (tx) => {
      const outcome = await amendSettings(
        tx,
        { audit: AUDIT },
        {
          tenantId: t.id,
          values: { password_min_length: 12 },
          ifMatch: before.etag,
          actorSubjectId: 'first',
        },
      );
      held.arrive();
      await held.open;
      return outcome;
    });

    await held.reached;
    const second = withTenant(fixture.app.db, t.id, (tx) =>
      amendSettings(
        tx,
        { audit: AUDIT },
        {
          tenantId: t.id,
          values: { password_min_length: 13 },
          ifMatch: before.etag,
          actorSubjectId: 'second',
        },
      ),
    );

    await awaitBlockedTransaction();
    held.release();

    expect((await first).kind).toBe('amended');
    expect((await second).kind).toBe('precondition_failed');
    const after = await withTenant(fixture.app.db, t.id, (tx) => readSettings(tx, t.id));
    expect(after.settings.password_min_length).toBe(12);
  });

  it('lets the first client amendment win and refuses the second', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const client = await fixture.createConfidentialClient(t.name, {});
    const deps = { tlsClientAuthEnabled: false, audit: AUDIT };
    const etag = await withTenant(fixture.app.db, t.id, async (tx) => {
      const outcome = await readClient(tx, client.id);
      if (outcome.kind !== 'ok') throw new Error('expected the client to be readable');
      return etagOf(clientWireShape(outcome.client));
    });
    const held = gate();

    const first = withTenant(fixture.app.db, t.id, async (tx) => {
      const outcome = await amendClient(tx, deps, {
        clientDbId: client.id,
        values: { name: 'first' },
        ifMatch: etag,
        actorSubjectId: 'first',
      });
      held.arrive();
      await held.open;
      return outcome;
    });

    await held.reached;
    const second = withTenant(fixture.app.db, t.id, (tx) =>
      amendClient(tx, deps, {
        clientDbId: client.id,
        values: { name: 'second' },
        ifMatch: etag,
        actorSubjectId: 'second',
      }),
    );

    await awaitBlockedTransaction();
    held.release();

    expect((await first).kind).toBe('ok');
    expect((await second).kind).toBe('precondition_failed');
    const after = await withTenant(fixture.app.db, t.id, (tx) => readClient(tx, client.id));
    expect(after.kind === 'ok' ? after.client.name : null).toBe('first');
  });
});
