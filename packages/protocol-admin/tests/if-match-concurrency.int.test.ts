import { withTenant } from '@odudu/db';
import { roleRepository, roles as rolesTable, subjectRoles } from '@odudu/domain-authz';
import { ADMIN_CLIENT_ID, clientRepository } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { etagOf } from '#/service/etag';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';
import { amendClient, clientWireShape, readClient } from '#/usecase/clients';
import { amendSettings, readSettings } from '#/usecase/settings';
import { setRequiredActions, setRoles } from '#/usecase/subjects';

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
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
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
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
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
        actorTenantId: 'test-tenant',
        actorClientId: 'test-client',
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
        actorTenantId: 'test-tenant',
        actorClientId: 'test-client',
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

async function capabilityRoleId(tenantId: string, name: string): Promise<string> {
  return withTenant(fixture.app.db, tenantId, async (tx) => {
    const adminClient = await clientRepository(tx).byClientId(ADMIN_CLIENT_ID);
    if (adminClient === null) throw new Error('fixture: tenant has no built-in admin client');
    const role = await roleRepository(tx).byName(name, adminClient.id);
    if (role === null) throw new Error(`fixture: no role named ${JSON.stringify(name)}`);
    return role.id;
  });
}

// `*` rather than a captured tag, so what these two prove is the lock
// alone: without it, two concurrent replacements under READ COMMITTED each
// delete a snapshot the other's insert is invisible to, and both commit,
// leaving the union of the two requests rather than either one alone.
// `list-preconditions.int.test.ts` is where a real tag is spent and
// replayed.
describe('two concurrent replacements whose If-Match matches whatever it finds', () => {
  it('serialises two concurrent role replacements instead of unioning them', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id: subjectId } = await fixture.createSubject(t.name, `target-${newId()}`);
    const viewUsersId = await capabilityRoleId(t.id, 'view-users');
    const manageClientsId = await capabilityRoleId(t.id, 'manage-clients');
    const callerCapabilities = new Set(['view-users', 'manage-clients']);
    const held = gate();

    const first = withTenant(fixture.app.db, t.id, async (tx) => {
      const outcome = await setRoles(
        tx,
        { audit: AUDIT },
        {
          subjectId,
          roleIds: [viewUsersId],
          callerCapabilities,
          ifMatch: '*',
          actorSubjectId: 'first',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      );
      held.arrive();
      await held.open;
      return outcome;
    });

    await held.reached;
    const second = withTenant(fixture.app.db, t.id, (tx) =>
      setRoles(
        tx,
        { audit: AUDIT },
        {
          subjectId,
          roleIds: [manageClientsId],
          callerCapabilities,
          ifMatch: '*',
          actorSubjectId: 'second',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );

    await awaitBlockedTransaction();
    held.release();

    expect((await first).kind).toBe('ok');
    expect((await second).kind).toBe('ok');

    // The union an unlocked pair would leave behind is exactly what this
    // rules out: `second` ran after `first` committed, so its replacement
    // is the only one left standing — `view-users` gone, `manage-clients`
    // alone.
    const names = await withTenant(fixture.app.db, t.id, (tx) =>
      tx
        .select({ name: rolesTable.name })
        .from(subjectRoles)
        .innerJoin(rolesTable, eq(rolesTable.id, subjectRoles.roleId))
        .where(eq(subjectRoles.subjectId, subjectId)),
    );
    expect(names.map((row) => row.name)).toEqual(['manage-clients']);
  });

  it('serialises two concurrent required-action replacements instead of unioning them', async () => {
    const t = await fixture.createTenant(`acme-${newId()}`);
    const { id: subjectId } = await fixture.createSubject(t.name, `target-${newId()}`);
    const held = gate();

    const first = withTenant(fixture.app.db, t.id, async (tx) => {
      const outcome = await setRequiredActions(
        tx,
        { audit: AUDIT },
        {
          tenantId: t.id,
          subjectId,
          actions: ['configure-totp'],
          ifMatch: '*',
          actorSubjectId: 'first',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      );
      held.arrive();
      await held.open;
      return outcome;
    });

    await held.reached;
    const second = withTenant(fixture.app.db, t.id, (tx) =>
      setRequiredActions(
        tx,
        {
          audit: AUDIT,
        },
        {
          tenantId: t.id,
          subjectId,
          actions: ['generate-recovery-codes'],
          ifMatch: '*',
          actorSubjectId: 'second',
          actorTenantId: 'test-tenant',
          actorClientId: 'test-client',
        },
      ),
    );

    await awaitBlockedTransaction();
    held.release();

    expect((await first).kind).toBe('ok');
    const secondOutcome = await second;
    expect(secondOutcome.kind).toBe('ok');
    // The union `first` and `second` would leave behind if unlocked is
    // exactly what this proves absent: `second` ran after `first`
    // committed, so its replacement is the only one left standing.
    expect(secondOutcome.kind === 'ok' ? secondOutcome.actions : null).toEqual([
      'generate-recovery-codes',
    ]);
  });
});
