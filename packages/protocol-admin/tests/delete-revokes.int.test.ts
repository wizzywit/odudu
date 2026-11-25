import { withTenant } from '@odudu/db';
import { agentInstanceRepository } from '@odudu/domain-agents';
import { newId } from '@odudu/kernel';
import { tokenGrantRepository } from '@odudu/protocol-oidc';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

const HOUR = 3_600_000;

interface World {
  readonly t: { id: string; name: string };
  readonly person: string;
  // The client the test deletes, and a client the lineage reaches into.
  readonly doomed: { id: string };
  readonly other: { id: string };
}

async function world(): Promise<World> {
  const t = await fixture.createTenant(`del-${newId()}`);
  const { id: person } = await fixture.createSubject(t.name, `person-${newId()}`);
  const doomed = await fixture.createConfidentialClient(t.name, {});
  const other = await fixture.createConfidentialClient(t.name, {});
  return { t, person, doomed, other };
}

function grant(
  w: World,
  over: {
    clientId: string;
    subjectId: string;
    from?: string;
    actor?: string;
  },
): Promise<string> {
  const id = newId();
  return withTenant(fixture.app.db, w.t.id, async (tx) => {
    await tokenGrantRepository(tx).create({
      id,
      tenantId: w.t.id,
      clientId: over.clientId,
      subjectId: over.subjectId,
      scope: 'mcp:read',
      audience: ['https://odudu.test/mcp'],
      ...(over.from === undefined ? {} : { exchangedFromGrantId: over.from }),
      ...(over.actor === undefined ? {} : { actorSubjectId: over.actor }),
    });
    return id;
  });
}

function instance(w: World, rootGrantId: string, agentClientId: string, owner: string) {
  const id = newId();
  return withTenant(fixture.app.db, w.t.id, async (tx) => {
    await agentInstanceRepository(tx).mint({
      id,
      tenantId: w.t.id,
      ownerSubjectId: owner,
      agentClientId,
      parentInstanceId: null,
      rootGrantId,
      depth: 1,
      scope: 'mcp:read',
      expiresAt: new Date(Date.now() + HOUR),
      idleExpiresAt: null,
    });
    return id;
  });
}

async function revoked(w: World, id: string): Promise<boolean> {
  return withTenant(fixture.app.db, w.t.id, async (tx) => {
    const found = await tokenGrantRepository(tx).byId(id);
    if (found === null) throw new Error('the grant is gone');
    return found.revokedAt !== null;
  });
}

async function subjectCount(w: World, type: string): Promise<number> {
  const rows = await fixture.owner.sql<{ n: number }[]>`
    select count(*)::int as n from subjects where tenant_id = ${w.t.id} and type = ${type}`;
  return rows[0]?.n ?? 0;
}

async function waitForLockWait(): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const rows = await fixture.owner.sql<{ n: number }[]>`
      select count(*)::int as n from pg_stat_activity
       where wait_event_type = 'Lock' and datname = current_database()`;
    if ((rows[0]?.n ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('the delete never waited on the held lineage root');
}

// Holds the root of a lineage the way a concurrent revoker does, so a delete that
// takes lineage roots first must wait for it, and one that does not would finish.
async function deleteWhileRootHeld(
  w: World,
  root: string,
  request: () => Promise<{ statusCode: number }>,
): Promise<number> {
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held: () => void = () => undefined;
  const gotLock = new Promise<void>((resolve) => {
    held = resolve;
  });
  const holder = withTenant(fixture.app.db, w.t.id, async (tx) => {
    await tx.execute(sql`select id from token_grants where id = ${root} for no key update`);
    held();
    await released;
  });
  await Promise.race([gotLock, holder]);
  const deleting = request();
  try {
    await waitForLockWait();
  } finally {
    release();
  }
  const [response] = await Promise.all([deleting, holder]);
  return response.statusCode;
}

describe('DELETE clients/:id', () => {
  it('ends what was exchanged from its grants, and the delegated tokens of its account', async () => {
    const w = await world();
    const accountClient = await fixture.createServiceAccountClient(w.t.name, []);
    const accountRows = await fixture.owner.sql<{ sa: string }[]>`
      select service_subject_id as sa from clients where id = ${accountClient.id}`;
    const account = accountRows[0]?.sa ?? '';
    const root = await grant(w, { clientId: w.doomed.id, subjectId: w.person });
    const child = await grant(w, { clientId: w.other.id, subjectId: w.person, from: root });
    const delegated = await grant(w, {
      clientId: w.other.id,
      subjectId: w.person,
      actor: account,
    });
    await instance(w, root, w.other.id, w.person);
    const token = await fixture.adminToken(w.t.name, ['manage-clients']);

    const res = await fixture.http.inject({
      method: 'DELETE',
      url: `/admin/tenants/${w.t.name}/clients/${w.doomed.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(204);
    expect(await revoked(w, child)).toBe(true);
    expect(await revoked(w, delegated)).toBe(false);
    expect(await subjectCount(w, 'agent_instance')).toBe(0);

    const retired = await fixture.http.inject({
      method: 'DELETE',
      url: `/admin/tenants/${w.t.name}/clients/${accountClient.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(retired.statusCode).toBe(204);
    expect(await revoked(w, delegated)).toBe(true);
  });

  it('removes the instances it takes with it, with no subject left behind', async () => {
    const w = await world();
    const root = await grant(w, { clientId: w.other.id, subjectId: w.person });
    await instance(w, root, w.doomed.id, w.person);
    expect(await subjectCount(w, 'agent_instance')).toBe(1);
    const token = await fixture.adminToken(w.t.name, ['manage-clients']);
    const res = await fixture.http.inject({
      method: 'DELETE',
      url: `/admin/tenants/${w.t.name}/clients/${w.doomed.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(204);
    expect(await subjectCount(w, 'agent_instance')).toBe(0);
    expect(await revoked(w, root)).toBe(false);
  });

  it('waits for a revoker holding the root of the lineage instead of deadlocking with it', async () => {
    const w = await world();
    const root = await grant(w, { clientId: w.other.id, subjectId: w.person });
    await grant(w, { clientId: w.doomed.id, subjectId: w.person, from: root });
    const token = await fixture.adminToken(w.t.name, ['manage-clients']);
    const status = await deleteWhileRootHeld(w, root, () =>
      fixture.http.inject({
        method: 'DELETE',
        url: `/admin/tenants/${w.t.name}/clients/${w.doomed.id}`,
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(status).toBe(204);
  });
});

describe('DELETE subjects/:id', () => {
  it('ends what was exchanged from the person’s grants and removes their instances', async () => {
    const w = await world();
    const root = await grant(w, { clientId: w.doomed.id, subjectId: w.person });
    await grant(w, { clientId: w.other.id, subjectId: w.person, from: root });
    const other = (await fixture.createSubject(w.t.name, `other-${newId()}`)).id;
    const foreign = await grant(w, { clientId: w.other.id, subjectId: other, from: root });
    await instance(w, root, w.other.id, w.person);
    const token = await fixture.adminToken(w.t.name, ['manage-users']);

    const res = await fixture.http.inject({
      method: 'DELETE',
      url: `/admin/tenants/${w.t.name}/subjects/${w.person}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(204);
    expect(await revoked(w, foreign)).toBe(true);
    expect(await subjectCount(w, 'agent_instance')).toBe(0);
  });

  it('waits for a revoker holding the root of the lineage instead of deadlocking with it', async () => {
    const w = await world();
    const other = (await fixture.createSubject(w.t.name, `other-${newId()}`)).id;
    const root = await grant(w, { clientId: w.other.id, subjectId: other });
    await grant(w, { clientId: w.other.id, subjectId: w.person, from: root });
    const token = await fixture.adminToken(w.t.name, ['manage-users']);
    const status = await deleteWhileRootHeld(w, root, () =>
      fixture.http.inject({
        method: 'DELETE',
        url: `/admin/tenants/${w.t.name}/subjects/${w.person}`,
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(status).toBe(204);
  });
});
