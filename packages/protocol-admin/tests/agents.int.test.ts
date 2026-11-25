import { withTenant, type TenantScopedDatabase } from '@odudu/db';
import {
  agentApprovalRepository,
  agentInstanceRepository,
  type AgentApprovalState,
} from '@odudu/domain-agents';
import { auditRepository } from '@odudu/domain-audit';
import { roleRepository } from '@odudu/domain-authz';
import { ADMIN_CLIENT_ID, clientRepository, TENANT_ADMIN } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { tokenGrantRepository } from '@odudu/protocol-oidc';
import { sql } from 'drizzle-orm';
import { type LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';
import { revokeAgent } from '#/usecase/agents';

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
const DIGEST = 'd'.repeat(64);

interface Tenant {
  readonly t: { id: string; name: string };
  readonly owner: string;
  readonly ownerName: string;
  readonly client: { id: string; clientId: string };
  readonly grantId: string;
}

async function world(): Promise<Tenant> {
  const t = await fixture.createTenant(`agents-${newId()}`);
  const ownerName = `owner-${newId()}`;
  const { id: owner } = await fixture.createSubject(t.name, ownerName);
  const client = await fixture.createConfidentialClient(t.name, {});
  const grantId = newId();
  await withTenant(fixture.app.db, t.id, (tx) =>
    tokenGrantRepository(tx).create({
      id: grantId,
      tenantId: t.id,
      clientId: client.id,
      subjectId: owner,
      scope: 'mcp:write',
      audience: ['https://odudu.test/mcp'],
    }),
  );
  return { t, owner, ownerName, client, grantId };
}

async function mint(
  w: Tenant,
  over: {
    id?: string;
    parent?: string | null;
    depth?: number;
    owner?: string;
    expiresAt?: Date;
    slice?: { mutating: number; creates: number };
  } = {},
): Promise<string> {
  const id = over.id ?? newId();
  await withTenant(fixture.app.db, w.t.id, (tx) =>
    agentInstanceRepository(tx).mint({
      id,
      tenantId: w.t.id,
      ownerSubjectId: over.owner ?? w.owner,
      agentClientId: w.client.id,
      parentInstanceId: over.parent ?? null,
      rootGrantId: w.grantId,
      depth: over.depth ?? 1,
      scope: 'mcp:write',
      expiresAt: over.expiresAt ?? new Date(Date.now() + HOUR),
      idleExpiresAt: null,
      ...(over.slice === undefined ? {} : { slice: over.slice }),
    }),
  );
  return id;
}

// A grant the instance acted in, with one exchanged from it.
async function actorGrants(w: Tenant, instance: string): Promise<[string, string]> {
  const acted = newId();
  const below = newId();
  await withTenant(fixture.app.db, w.t.id, async (tx) => {
    const grants = tokenGrantRepository(tx);
    const base = {
      tenantId: w.t.id,
      clientId: w.client.id,
      subjectId: w.owner,
      scope: 'mcp:read',
      audience: ['https://odudu.test/mcp'],
    };
    await grants.create({ ...base, id: acted, actorSubjectId: instance });
    await grants.create({ ...base, id: below, exchangedFromGrantId: acted });
  });
  return [acted, below];
}

async function state(w: Tenant, ids: readonly string[], grants: readonly string[] = []) {
  return withTenant(fixture.app.db, w.t.id, async (tx) => ({
    instances: await Promise.all(
      ids.map(async (id) => (await agentInstanceRepository(tx).byId(id))?.revokedAt !== null),
    ),
    grants: await Promise.all(
      grants.map(async (id) => (await tokenGrantRepository(tx).byId(id))?.revokedAt !== null),
    ),
  }));
}

async function waitForLockWait(): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const rows = await fixture.owner.sql<{ n: number }[]>`
      select count(*)::int as n from pg_stat_activity
       where wait_event_type = 'Lock' and datname = current_database()`;
    if ((rows[0]?.n ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('the revocation never waited on the held grant');
}

function auditOf(w: Tenant) {
  return withTenant(fixture.app.db, w.t.id, (tx) => auditRepository(tx).list({ limit: 200 }));
}

function request(
  method: 'GET' | 'DELETE',
  w: Tenant,
  path: string,
  token: string,
): Promise<LightMyRequestResponse> {
  return fixture.http.inject({
    method,
    url: `/admin/tenants/${w.t.name}/${path}`,
    headers: { authorization: `Bearer ${token}` },
  });
}

describe('GET …/agents', () => {
  it('lists instances in id order with their lineage, a page at a time', async () => {
    const w = await world();
    const root = await mint(w);
    const child = await mint(w, { parent: root, depth: 2 });
    const grandchild = await mint(w, { parent: child, depth: 3 });
    const token = await fixture.adminToken(w.t.name, ['manage-sessions']);

    const all = await request('GET', w, 'agents', token);
    expect(all.statusCode).toBe(200);
    const body = all.json<{ items: Record<string, unknown>[]; next?: string }>();
    expect(body.next).toBeUndefined();
    expect(body.items.map((item) => item.id)).toEqual([root, child, grandchild]);
    expect(body.items[1]).toMatchObject({
      owner: w.owner,
      owner_username: w.ownerName,
      agent_client: w.client.clientId,
      parent: root,
      depth: 2,
      state: 'live',
      scope: 'mcp:write',
      revoked_at: null,
      remaining_budget: { mutating: 20, creates: 10 },
    });
    expect(typeof body.items[1]?.expires_at).toBe('string');
    expect(body.items[0]?.parent).toBeNull();

    const first = await request('GET', w, 'agents?limit=2', token);
    const page = first.json<{ items: { id: string }[]; next?: string }>();
    expect(page.items.map((item) => item.id)).toEqual([root, child]);
    expect(String(first.headers.link)).toContain('rel="next"');
    const second = await request(
      'GET',
      w,
      `agents?limit=2&cursor=${encodeURIComponent(page.next ?? '')}`,
      token,
    );
    expect(second.json<{ items: { id: string }[] }>().items.map((i) => i.id)).toEqual([grandchild]);
  });

  it('filters by owner and by state, and refuses what it does not know', async () => {
    const w = await world();
    const { id: other } = await fixture.createSubject(w.t.name, `other-${newId()}`);
    const mine = await mint(w);
    const theirs = await mint(w, { owner: other });
    const gone = await mint(w);
    const lapsed = await mint(w, { expiresAt: new Date(Date.now() - 1000) });
    await withTenant(fixture.app.db, w.t.id, (tx) =>
      agentInstanceRepository(tx).revoke(gone, new Date()),
    );
    const token = await fixture.adminToken(w.t.name, ['manage-sessions']);
    const ids = async (query: string) =>
      (await request('GET', w, `agents?${query}`, token))
        .json<{ items: { id: string }[] }>()
        .items.map((item) => item.id);

    expect(await ids(`owner=${other}`)).toEqual([theirs]);
    expect((await ids(`owner=${w.owner}&state=live`)).sort()).toEqual([mine].sort());
    expect(await ids('state=revoked')).toEqual([gone]);
    expect(await ids('state=expired')).toEqual([lapsed]);
    for (const bad of ['state=bogus', 'owner=alice', 'limit=0', 'cursor=nonsense', 'x=1']) {
      expect((await request('GET', w, `agents?${bad}`, token)).statusCode, bad).toBe(400);
    }
  });

  it('shows what an instance has left of its slice, never less than none', async () => {
    const w = await world();
    const id = await mint(w, { slice: { mutating: 5, creates: 2 } });
    await withTenant(fixture.app.db, w.t.id, (tx) =>
      tx.execute(
        sql`update agent_instances set spent_mutating = 3, spent_creates = 2 where id = ${id}`,
      ),
    );
    const token = await fixture.adminToken(w.t.name, ['manage-sessions']);
    const res = await request('GET', w, `agents/${id}`, token);
    expect(res.json<{ remaining_budget: unknown }>().remaining_budget).toEqual({
      mutating: 2,
      creates: 0,
    });
  });

  it('answers a caller without manage-sessions 403, and a foreign tenant nothing', async () => {
    const w = await world();
    const other = await world();
    await mint(w);
    await mint(other);
    expect(
      (await request('GET', w, 'agents', await fixture.adminToken(w.t.name, ['view-audit'])))
        .statusCode,
    ).toBe(403);
    const seen = await request(
      'GET',
      other,
      'agents',
      await fixture.adminToken(other.t.name, ['manage-sessions']),
    );
    expect(seen.json<{ items: unknown[] }>().items).toHaveLength(1);
  });
});

describe('GET …/agents/:id', () => {
  it('reads one instance, and answers 404 for an unknown id or another tenant’s, and 400 for one that is no id', async () => {
    const w = await world();
    const other = await world();
    const id = await mint(w);
    const foreign = await mint(other);
    const token = await fixture.adminToken(w.t.name, ['manage-sessions']);

    const found = await request('GET', w, `agents/${id}`, token);
    expect(found.statusCode).toBe(200);
    expect(found.json()).toMatchObject({
      id,
      owner: w.owner,
      owner_username: w.ownerName,
      depth: 1,
    });
    expect((await request('GET', w, `agents/${newId()}`, token)).statusCode).toBe(404);
    expect((await request('GET', w, `agents/${foreign}`, token)).statusCode).toBe(404);
    expect((await request('GET', w, 'agents/not-an-id', token)).statusCode).toBe(400);
  });
});

describe('DELETE …/agents/:id', () => {
  async function tree(w: Tenant) {
    const root = await mint(w);
    const child = await mint(w, { parent: root, depth: 2 });
    const grandchild = await mint(w, { parent: child, depth: 3 });
    const sibling = await mint(w);
    const [acted, below] = await actorGrants(w, child);
    return { root, child, grandchild, sibling, acted, below };
  }

  it('revokes the instance, everything beneath it and the grants it acted in, and says how many', async () => {
    const w = await world();
    const t = await tree(w);
    const token = await fixture.adminToken(w.t.name, ['manage-sessions']);

    const res = await request('DELETE', w, `agents/${t.child}`, token);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ grants: 2, instances: 2 });
    expect(await state(w, [t.root, t.child, t.grandchild, t.sibling], [t.acted, t.below])).toEqual({
      instances: [false, true, true, false],
      grants: [true, true],
    });

    const again = await request('DELETE', w, `agents/${t.child}`, token);
    expect(again.json()).toEqual({ grants: 0, instances: 0 });
  });

  it('records the revocation for the instance and for the administrator who made it', async () => {
    const w = await world();
    const t = await tree(w);
    const token = await fixture.adminToken(w.t.name, ['manage-sessions']);
    await request('DELETE', w, `agents/${t.child}`, token);

    const rows = await auditOf(w);
    const lineage = rows.filter((row) => row.action === 'agent.instance_revoked');
    expect(lineage).toHaveLength(1);
    expect(lineage[0]).toMatchObject({
      eventType: 'agent_identity',
      outcome: 'allowed',
      resourceType: 'agent_instance',
      resourceId: t.child,
      actorSubjectId: w.owner,
    });
    expect(lineage[0]?.detail).toEqual({
      agent_client: w.client.clientId,
      owner: w.owner,
      instance: t.child,
      depth: 2,
      count: 2,
      via: 'admin',
    });
    const admin = rows.filter((row) => row.action === 'agent.instance_revoke');
    expect(admin).toHaveLength(1);
    expect(admin[0]).toMatchObject({
      eventType: 'admin_mutation',
      outcome: 'allowed',
      resourceId: t.child,
    });
    expect(admin[0]?.actorSubjectId).not.toBe(w.owner);

    await request('DELETE', w, `agents/${t.child}`, token);
    expect((await auditOf(w)).length).toBe(rows.length);
  });

  it('with dry_run answers what would be revoked and changes and records nothing', async () => {
    const w = await world();
    const t = await tree(w);
    const token = await fixture.adminToken(w.t.name, ['manage-sessions']);
    const before = (await auditOf(w)).length;

    const dry = await request('DELETE', w, `agents/${t.root}?dry_run=true`, token);
    expect(dry.statusCode).toBe(200);
    expect(dry.json()).toEqual({ grants: 2, instances: 3 });
    expect(await state(w, [t.root, t.child, t.grandchild, t.sibling], [t.acted, t.below])).toEqual({
      instances: [false, false, false, false],
      grants: [false, false],
    });
    expect((await auditOf(w)).length).toBe(before);

    const real = await request('DELETE', w, `agents/${t.root}?dry_run=false`, token);
    expect(real.json()).toEqual({ grants: 2, instances: 3 });
    expect(await state(w, [t.root, t.child, t.grandchild])).toEqual({
      instances: [true, true, true],
      grants: [],
    });
    expect((await request('DELETE', w, `agents/${t.root}?dry_run=maybe`, token)).statusCode).toBe(
      400,
    );
  });

  it('ends a child started while it waited on a grant, with the grants that child acted in', async () => {
    const w = await world();
    const child = await mint(w, { depth: 2 });
    const [acted] = await actorGrants(w, child);

    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held: () => void = () => undefined;
    const locked = new Promise<void>((resolve) => {
      held = resolve;
    });
    const blocker = fixture.owner.sql.begin(async (q) => {
      await q`select id from token_grants where id = ${acted} for update`;
      held();
      await gate;
    });
    await locked;
    const revoking = withTenant(fixture.app.db, w.t.id, (tx) =>
      revokeAgent(
        tx,
        { audit: () => Promise.resolve() },
        {
          instanceId: child,
          dryRun: false,
          now: new Date(),
          callerCapabilities: new Set(),
          actorSubjectId: w.owner,
          actorTenantId: w.t.id,
          actorClientId: w.client.id,
        },
      ),
    );
    await waitForLockWait();
    const late = await mint(w, { parent: child, depth: 3 });
    const [lateActed, lateBelow] = await actorGrants(w, late);
    release();
    await blocker;

    expect(await revoking).toEqual({ kind: 'revoked', grants: 4, instances: 2 });
    expect(await state(w, [child, late], [acted, lateActed, lateBelow])).toEqual({
      instances: [true, true],
      grants: [true, true, true],
    });
    const lineage = (await auditOf(w)).filter((row) => row.action === 'agent.instance_revoked');
    expect(lineage.map((row) => row.detail)).toEqual([expect.objectContaining({ count: 2 })]);
  });

  it('answers 404 for an unknown instance and leaves another tenant’s alone', async () => {
    const w = await world();
    const other = await world();
    const foreign = await mint(other);
    const token = await fixture.adminToken(w.t.name, ['manage-sessions']);

    expect((await request('DELETE', w, `agents/${newId()}`, token)).statusCode).toBe(404);
    expect((await request('DELETE', w, `agents/${foreign}`, token)).statusCode).toBe(404);
    expect((await request('DELETE', w, `agents/${foreign}?dry_run=true`, token)).statusCode).toBe(
      404,
    );
    expect(await state(other, [foreign])).toEqual({ instances: [false], grants: [] });
  });

  it('needs manage-sessions', async () => {
    const w = await world();
    const id = await mint(w);
    const res = await request(
      'DELETE',
      w,
      `agents/${id}`,
      await fixture.adminToken(w.t.name, ['view-users', 'manage-users']),
    );
    expect(res.statusCode).toBe(403);
    expect(await state(w, [id])).toEqual({ instances: [false], grants: [] });
  });

  it('refuses a caller short of what the owner holds, and records the refusal', async () => {
    const w = await world();
    await withTenant(fixture.app.db, w.t.id, async (tx) => {
      const adminClient = await clientRepository(tx).byClientId(ADMIN_CLIENT_ID);
      if (adminClient === null) throw new Error('fixture: no built-in admin client');
      const role = await roleRepository(tx).byName(TENANT_ADMIN, adminClient.id);
      if (role === null) throw new Error('fixture: no tenant-admin role');
      await roleRepository(tx).assignToSubject(w.owner, role.id);
    });
    const id = await mint(w);
    const token = await fixture.adminToken(w.t.name, ['manage-sessions']);

    for (const query of ['', '?dry_run=true']) {
      const res = await request('DELETE', w, `agents/${id}${query}`, token);
      expect(res.statusCode, query).toBe(403);
    }
    expect(await state(w, [id])).toEqual({ instances: [false], grants: [] });
    const refused = (await auditOf(w)).filter(
      (row) => row.action === 'agent.instance_revoke' && row.outcome === 'refused',
    );
    expect(refused).toHaveLength(1);
    expect(refused[0]?.resourceId).toBe(id);
  });
});

describe('GET …/agent-approvals', () => {
  async function approve(
    w: Tenant,
    state: AgentApprovalState,
    over: { instance?: string | null; owner?: string } = {},
  ): Promise<string> {
    const id = newId();
    await withTenant(fixture.app.db, w.t.id, async (tx: TenantScopedDatabase) => {
      const repo = agentApprovalRepository(tx);
      await repo.create({
        id,
        tenantId: w.t.id,
        subjectId: over.owner ?? w.owner,
        requestingClientId: w.client.id,
        instanceId: over.instance ?? null,
        kind: 'tool_call',
        summary: 'Delete a client',
        actionDigest: DIGEST,
        expiresAt: new Date(Date.now() + HOUR),
      });
      if (state === 'approved' || state === 'consumed') {
        await repo.decide(id, 'approved', 'console', new Date());
      }
      if (state === 'denied') await repo.decide(id, 'denied', 'ciba_page', new Date());
      if (state === 'consumed') await repo.consume(id, DIGEST, new Date());
      if (state === 'expired') {
        await tx.execute(sql`update agent_approvals set state = 'expired' where id = ${id}`);
      }
    });
    return id;
  }

  it('lists newest first, a page at a time, and never the digest', async () => {
    const w = await world();
    const instance = await mint(w);
    const a = await approve(w, 'pending', { instance });
    const b = await approve(w, 'approved');
    const c = await approve(w, 'denied');
    const token = await fixture.adminToken(w.t.name, ['manage-sessions']);

    const all = await request('GET', w, 'agent-approvals', token);
    expect(all.statusCode).toBe(200);
    const items = all.json<{ items: Record<string, unknown>[] }>().items;
    expect(items.map((item) => item.id)).toEqual([c, b, a]);
    expect(items[2]).toMatchObject({
      id: a,
      owner: w.owner,
      owner_username: w.ownerName,
      agent_client: w.client.clientId,
      instance,
      kind: 'tool_call',
      summary: 'Delete a client',
      state: 'pending',
      decided_at: null,
      decided_via: null,
    });
    expect(Object.keys(items[2] ?? {}).sort()).toEqual([
      'agent_client',
      'created_at',
      'decided_at',
      'decided_via',
      'expires_at',
      'id',
      'instance',
      'kind',
      'owner',
      'owner_username',
      'state',
      'summary',
    ]);
    expect(items[1]).toMatchObject({ state: 'approved', decided_via: 'console' });
    expect(JSON.stringify(items)).not.toContain(DIGEST);

    const first = await request('GET', w, 'agent-approvals?limit=2', token);
    const page = first.json<{ items: { id: string }[]; next?: string }>();
    expect(page.items.map((item) => item.id)).toEqual([c, b]);
    expect(String(first.headers.link)).toContain('rel="next"');
    const second = await request(
      'GET',
      w,
      `agent-approvals?limit=2&cursor=${encodeURIComponent(page.next ?? '')}`,
      token,
    );
    expect(second.json<{ items: { id: string }[] }>().items.map((i) => i.id)).toEqual([a]);
  });

  it('filters by state and refuses a state it does not know', async () => {
    const w = await world();
    const pending = await approve(w, 'pending');
    const consumed = await approve(w, 'consumed');
    const expired = await approve(w, 'expired');
    const token = await fixture.adminToken(w.t.name, ['manage-sessions']);
    const ids = async (state: string) =>
      (await request('GET', w, `agent-approvals?state=${state}`, token))
        .json<{ items: { id: string }[] }>()
        .items.map((item) => item.id);
    expect(await ids('pending')).toEqual([pending]);
    expect(await ids('consumed')).toEqual([consumed]);
    expect(await ids('expired')).toEqual([expired]);
    expect(await ids('denied')).toEqual([]);
    expect((await request('GET', w, 'agent-approvals?state=live', token)).statusCode).toBe(400);
    expect((await request('GET', w, 'agent-approvals?cursor=nonsense', token)).statusCode).toBe(
      400,
    );
  });

  it('needs manage-sessions, and shows a tenant only its own', async () => {
    const w = await world();
    const other = await world();
    await approve(w, 'pending');
    await approve(other, 'pending');
    expect(
      (
        await request(
          'GET',
          w,
          'agent-approvals',
          await fixture.adminToken(w.t.name, ['view-users']),
        )
      ).statusCode,
    ).toBe(403);
    const mine = await request(
      'GET',
      w,
      'agent-approvals',
      await fixture.adminToken(w.t.name, ['manage-sessions']),
    );
    expect(mine.json<{ items: unknown[] }>().items).toHaveLength(1);
  });
});

describe('an agent token on the agent routes', () => {
  async function refused(
    method: 'GET' | 'DELETE',
    path: string,
    scope: 'mcp:read' | 'mcp:write',
    options: { via?: 'mcp' } = {},
  ) {
    const w = await world();
    const id = await mint(w);
    const token = await fixture.agentToken(w.t.name, ['view-users', 'manage-sessions'], {
      scope,
      act: { sub: 'agent-client' },
      ...options,
    });
    const res = await request(method, w, path.replace(':id', id), token);
    return { res, w, id };
  }

  it.each([
    ['GET', 'agents', 'mcp:read'],
    ['GET', 'agents/:id', 'mcp:read'],
    ['GET', 'agent-approvals', 'mcp:read'],
    ['GET', 'agents', 'mcp:write'],
    ['GET', 'agents/:id', 'mcp:write'],
    ['GET', 'agent-approvals', 'mcp:write'],
  ] as const)('is refused %s …/%s, holding %s', async (method, path, scope) => {
    const { res } = await refused(method, path, scope);
    expect(res.statusCode).toBe(403);
  });

  it.each([
    ['mcp:write', {}],
    ['mcp:write', { via: 'mcp' as const }],
  ] as const)(
    'is refused DELETE …/agents/:id holding %s %j, and nothing is revoked',
    async (scope, options) => {
      for (const query of ['', '?dry_run=true']) {
        const { res, w, id } = await refused('DELETE', `agents/:id${query}`, scope, options);
        expect(res.statusCode, query).toBe(403);
        expect(await state(w, [id])).toEqual({ instances: [false], grants: [] });
      }
    },
  );
});
