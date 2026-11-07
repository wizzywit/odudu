import { withTenant } from '@odudu/db';
import { groups, roles } from '@odudu/domain-authz';
import { auditEvents } from '@odudu/domain-audit';
import { clientScopes } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startAdminFixture, type AdminFixture } from '#/testing/admin-fixture';

// A create adds a row, and the budget that bounds creates is spent by the MCP
// endpoint. The door therefore admits a POST of the agent allowlist to a token
// the endpoint signed and to no other agent token: one issued to an agent that
// calls the admin API itself (`odudu mcp` over stdio, a service account) would
// create without a count.

let fixtureHandle: AdminFixture | undefined;
let fixture: AdminFixture;
beforeAll(async () => {
  fixtureHandle = await startAdminFixture();
  fixture = fixtureHandle;
}, 180_000);
afterAll(async () => {
  await fixtureHandle?.stop();
});

const ROUTES = ['roles', 'groups', 'scopes'] as const;

const rows = (tenantId: string, action: string) =>
  withTenant(fixture.app.db, tenantId, (tx) =>
    tx.select().from(auditEvents).where(eq(auditEvents.action, action)).orderBy(auditEvents.id),
  );

async function counts(tenantId: string): Promise<Record<(typeof ROUTES)[number], number>> {
  return withTenant(fixture.app.db, tenantId, async (tx) => ({
    roles: (await tx.select({ id: roles.id }).from(roles)).length,
    groups: (await tx.select({ id: groups.id }).from(groups)).length,
    scopes: (await tx.select({ id: clientScopes.id }).from(clientScopes)).length,
  }));
}

function post(tenant: string, route: string, token: string, payload: unknown, key?: string) {
  return fixture.http.inject({
    method: 'POST',
    url: `/admin/tenants/${tenant}/${route}`,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(key === undefined ? {} : { 'idempotency-key': key }),
    },
    payload: payload as never,
  });
}

const direct = (tenant: string) =>
  fixture.agentToken(tenant, ['manage-tenant'], { scope: 'mcp:write', viaMcpClient: true });
const exchanged = (tenant: string) =>
  fixture.agentToken(tenant, ['manage-tenant'], {
    scope: 'mcp:write',
    act: { sub: 'agent-client' },
  });
const viaEndpoint = (tenant: string) =>
  fixture.agentToken(tenant, ['manage-tenant'], {
    scope: 'mcp:write',
    act: { sub: 'agent-client' },
    via: 'mcp',
  });

describe('a create by an agent the MCP endpoint did not sign', () => {
  it.each([
    ['holds a token issued straight to it', direct],
    ['holds an exchanged token, which carries act and no marker', exchanged],
  ])('is refused for a role, a group and a scope when the agent %s', async (_label, mint) => {
    const t = await fixture.createTenant(`door-${newId()}`);
    const token = await mint(t.name);
    const before = await counts(t.id);
    for (const route of ROUTES) {
      const res = await post(t.name, route, token, { name: `made-${newId()}` }, `k-${newId()}`);
      expect(res.statusCode, route).toBe(403);
      expect(res.json()).toMatchObject({ detail: 'insufficient_scope' });
    }
    expect(await counts(t.id)).toEqual(before);
    const refusals = await rows(t.id, 'capability.refused');
    expect(refusals).toHaveLength(3);
    for (const row of refusals) {
      expect(row).toMatchObject({ outcome: 'refused', detail: { reason: 'insufficient_scope' } });
    }
    expect(await rows(t.id, 'agent.tool_call')).toEqual([]);
    for (const action of ['role.create', 'group.create', 'scope.create']) {
      expect(await rows(t.id, action), action).toEqual([]);
    }
  });

  it('is refused without a key too, and with a valid body, so only the token decides', async () => {
    const t = await fixture.createTenant(`door-${newId()}`);
    const token = await direct(t.name);
    const before = await counts(t.id);
    const res = await post(t.name, 'roles', token, { name: 'auditors', description: 'Reads' });
    expect(res.statusCode).toBe(403);
    expect(await counts(t.id)).toEqual(before);
  });

  it('still amends a description, which no budget bounds, and records the call at the door', async () => {
    const t = await fixture.createTenant(`door-${newId()}`);
    const admin = await fixture.adminToken(t.name, ['manage-tenant']);
    const made = await post(t.name, 'roles', admin, { name: 'auditors' });
    const id = made.json<{ id: string }>().id;
    const token = await direct(t.name);
    const read = await fixture.http.inject({
      method: 'GET',
      url: `/admin/tenants/${t.name}/roles/${id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const patched = await fixture.http.inject({
      method: 'PATCH',
      url: `/admin/tenants/${t.name}/roles/${id}`,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'if-match': String(read.headers.etag),
      },
      payload: { description: 'Reads the audit trail' },
    });
    expect(patched.statusCode).toBe(200);
    const calls = await rows(t.id, 'agent.tool_call');
    expect(calls.map((row) => (row.detail as { tool: string }).tool)).toEqual([
      'admin.get.roles.id',
      'admin.patch.roles.id',
    ]);
  });
});

describe('a create by a token the MCP endpoint signed', () => {
  it('makes a role, a group and a scope, and each audit row names what the agent chose', async () => {
    const t = await fixture.createTenant(`door-${newId()}`);
    const token = await viaEndpoint(t.name);
    const role = await post(
      t.name,
      'roles',
      token,
      { name: 'auditors', description: 'Reads the audit trail' },
      `k-${newId()}`,
    );
    const group = await post(
      t.name,
      'groups',
      token,
      { name: 'staff', description: 'Employees' },
      `k-${newId()}`,
    );
    const scope = await post(
      t.name,
      'scopes',
      token,
      {
        name: 'orders',
        description: 'Orders',
        description_i18n: { en: 'Orders' },
        display_order: 4,
      },
      `k-${newId()}`,
    );
    expect([role.statusCode, group.statusCode, scope.statusCode]).toEqual([201, 201, 201]);
    const [roleRow] = await rows(t.id, 'role.create');
    const [groupRow] = await rows(t.id, 'group.create');
    const [scopeRow] = await rows(t.id, 'scope.create');
    expect(roleRow?.detail).toEqual({
      name: { after: 'auditors' },
      description: { after: 'Reads the audit trail' },
    });
    expect(groupRow?.detail).toEqual({
      name: { after: 'staff' },
      description: { after: 'Employees' },
    });
    expect(scopeRow?.detail).toEqual({
      name: { after: 'orders' },
      description: { after: 'Orders' },
      description_i18n: { after: { en: 'Orders' } },
      display_order: { after: 4 },
    });
    // The endpoint records the call itself, so the door writes none.
    expect(await rows(t.id, 'agent.tool_call')).toEqual([]);
  });

  it('answers a repeat of one key from the stored response, with one row', async () => {
    const t = await fixture.createTenant(`door-${newId()}`);
    const token = await viaEndpoint(t.name);
    const key = `k-${newId()}`;
    const first = await post(t.name, 'roles', token, { name: 'auditors' }, key);
    const again = await post(t.name, 'roles', token, { name: 'auditors' }, key);
    expect([first.statusCode, again.statusCode]).toEqual([201, 201]);
    expect(again.json<{ id: string }>().id).toBe(first.json<{ id: string }>().id);
    expect(await rows(t.id, 'role.create')).toHaveLength(1);
    const other = await post(t.name, 'roles', token, { name: 'different' }, key);
    expect(other.statusCode).toBe(422);
  });

  // A field the create shape names is the door's refusal, 403. One the shape
  // does not name never reaches the door: the route's own validation answers 400.
  // Either way nothing is created.
  it('is refused for any field outside the allowlist, six bodies to a route, and creates nothing', async () => {
    const t = await fixture.createTenant(`door-${newId()}`);
    const token = await viaEndpoint(t.name);
    const before = await counts(t.id);
    const other = newId();
    const bodies: Record<(typeof ROUTES)[number], [Record<string, unknown>, number][]> = {
      roles: [
        [{ name: 'r', default_for_new_subjects: true }, 403],
        [{ name: 'r', default_for_new_subjects: false }, 403],
        [{ name: 'r', description: 'd', client_id: other, default_for_new_subjects: true }, 403],
        [{ name: 'r', composites: [other] }, 400],
        [{ name: 'r', admin_reach: ['manage-tenant'] }, 400],
        [{ name: 'r', id: other }, 400],
      ],
      groups: [
        [{ name: 'g', parent_id: other }, 403],
        [{ name: 'g', parent_id: null }, 403],
        [{ name: 'g', description: 'd', parent_id: other }, 403],
        [{ name: 'g', default_for_new_subjects: true }, 400],
        [{ name: 'g', role_ids: [other] }, 400],
        [{ name: 'g', path: '/g' }, 400],
      ],
      scopes: [
        [{ name: 's', consent_text: 'agree to all' }, 403],
        [{ name: 's', consent_text_i18n: { en: 'x' } }, 403],
        [{ name: 's', include_in_id_token: true }, 403],
        [{ name: 's', include_in_access_token: true }, 403],
        [{ name: 's', default_client_assignment: 'default' }, 403],
        [{ name: 's', description: 'd', consent_text: 'x', display_order: 1 }, 403],
      ],
    };
    let door = 0;
    for (const route of ROUTES) {
      for (const [body, status] of bodies[route]) {
        const res = await post(t.name, route, token, body, `k-${newId()}`);
        expect(res.statusCode, `${route} ${JSON.stringify(body)}`).toBe(status);
        if (status === 403) {
          expect(res.json()).toMatchObject({ detail: 'insufficient_scope' });
          door += 1;
        }
      }
    }
    expect(await counts(t.id)).toEqual(before);
    expect(await rows(t.id, 'capability.refused')).toHaveLength(door);
  });
});

describe('a person’s own token', () => {
  it('creates a role, sets it as a default and is recorded with every field it chose', async () => {
    const t = await fixture.createTenant(`door-${newId()}`);
    const admin = await fixture.adminToken(t.name, ['manage-tenant']);
    const res = await post(t.name, 'roles', admin, {
      name: 'everyone',
      default_for_new_subjects: true,
    });
    expect(res.statusCode).toBe(201);
    const [row] = await rows(t.id, 'role.create');
    expect(row?.detail).toEqual({
      name: { after: 'everyone' },
      default_for_new_subjects: { after: true },
    });
  });
});
