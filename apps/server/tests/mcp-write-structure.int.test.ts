import {
  createGroupRequestSchema,
  createRoleRequestSchema,
  createScopeRequestSchema,
  GROUP_LIMIT,
  ROLE_LIMIT,
  SCOPE_LIMIT,
} from '@odudu/contracts/admin';
import { withTenant } from '@odudu/db';
import { groups, roles } from '@odudu/domain-authz';
import { clientScopes } from '@odudu/domain-tenant';
import { newId } from '@odudu/kernel';
import type { ToolResult } from '@odudu/mcp';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type McpStack, startMcpStack } from '#/testing/mcp-stack';
import type { World } from '#/testing/mcp-world';

// The five structure tools and the display order through the real endpoint,
// the real admin API and a real database: what an agent holding `mcp:write`
// can add and describe, and what refuses it.

let stack: McpStack;

beforeAll(async () => {
  stack = await startMcpStack();
}, 120_000);

afterAll(async () => {
  await stack.close();
});

const OWNER = ['manage-tenant', 'view-audit'];
const WRITE = 'mcp:read mcp:write';

interface Rec {
  readonly data: Record<string, unknown> & { id: string };
  readonly etag: string;
}

function recOf(result: ToolResult): Rec {
  expect(result.isError, JSON.stringify(result.structuredContent)).toBe(false);
  return result.structuredContent as unknown as Rec;
}

function errorOf(result: ToolResult): {
  type: string;
  title: string;
  status: number;
  detail?: string;
} {
  expect(result.isError).toBe(true);
  return (result.structuredContent as { error: never }).error;
}

async function sessionOf(capabilities: readonly string[] = OWNER) {
  const w = await stack.world(capabilities, WRITE);
  return { w, token: await stack.sign(w, WRITE) };
}

async function rows(w: World, action: string) {
  return stack.auditRows(w, action);
}

async function counts(w: World) {
  return withTenant(stack.appDb.db, w.tenantId, async (tx) => ({
    roles: (await tx.select({ id: roles.id }).from(roles)).length,
    groups: (await tx.select({ id: groups.id }).from(groups)).length,
    scopes: (await tx.select({ id: clientScopes.id }).from(clientScopes)).length,
  }));
}

const SHAPES: Record<string, string[] | undefined> = {
  '/admin/tenants/:tenant/roles': Object.keys(createRoleRequestSchema.shape),
  '/admin/tenants/:tenant/groups': Object.keys(createGroupRequestSchema.shape),
  '/admin/tenants/:tenant/scopes': Object.keys(createScopeRequestSchema.shape),
};

const key = () => `k-${newId()}`;

describe('create_role, create_group and create_scope', () => {
  it('make an empty role, group and scope, and each audit row names what the agent chose', async () => {
    const { w, token } = await sessionOf();
    const role = recOf(
      await stack.call(w, token, 'create_role', {
        idempotency_key: key(),
        name: 'auditors',
        description: 'Reads the audit trail',
      }),
    );
    const group = recOf(
      await stack.call(w, token, 'create_group', {
        idempotency_key: key(),
        name: 'staff',
        description: 'Employees',
      }),
    );
    const scope = recOf(
      await stack.call(w, token, 'create_scope', {
        idempotency_key: key(),
        name: 'orders:read',
        description: 'Read the orders of the person',
        description_i18n: { en: 'Read the orders of the person' },
        display_order: 7,
      }),
    );
    expect(role.data).toMatchObject({
      name: 'auditors',
      description: 'Reads the audit trail',
      default_for_new_subjects: false,
      client_id: null,
      admin_reach: [],
    });
    expect(group.data).toMatchObject({
      name: 'staff',
      parent_id: null,
      default_for_new_subjects: false,
      path: '/staff',
      admin_reach: [],
    });
    expect(scope.data).toMatchObject({
      name: 'orders:read',
      display_order: 7,
      consent_text: null,
      default_client_assignment: null,
    });
    for (const created of [role, group, scope]) expect(created.etag).toMatch(/^"[0-9a-f]{64}"$/u);

    const [roleRow] = await rows(w, 'role.create');
    const [groupRow] = await rows(w, 'group.create');
    const [scopeRow] = await rows(w, 'scope.create');
    for (const row of [roleRow, groupRow, scopeRow]) {
      expect(row).toMatchObject({
        outcome: 'allowed',
        actorSubjectId: w.subjectId,
        actorClientId: w.agentDbId,
      });
    }
    expect(roleRow?.detail).toEqual({
      name: { after: 'auditors' },
      description: { after: 'Reads the audit trail' },
    });
    expect(groupRow?.detail).toEqual({
      name: { after: 'staff' },
      description: { after: 'Employees' },
    });
    expect(scopeRow?.detail).toEqual({
      name: { after: 'orders:read' },
      description: { after: 'Read the orders of the person' },
      description_i18n: { after: { en: 'Read the orders of the person' } },
      display_order: { after: 7 },
    });
    const calls = await rows(w, 'agent.tool_call');
    expect(calls.map((c) => [c.outcome, (c.detail as { tool: string }).tool])).toEqual([
      ['allowed', 'create_role'],
      ['allowed', 'create_group'],
      ['allowed', 'create_scope'],
    ]);
  });

  it('is repeated with the same key and answers the first response, one row and one audit row', async () => {
    const { w, token } = await sessionOf();
    const args = { idempotency_key: key(), name: 'auditors' };
    const first = recOf(await stack.call(w, token, 'create_role', args));
    const again = recOf(await stack.call(w, token, 'create_role', args));
    expect(again.data.id).toBe(first.data.id);
    const rolesAfterFirst = (await counts(w)).roles;
    expect(await rows(w, 'role.create')).toHaveLength(1);
    const other = errorOf(
      await stack.call(w, token, 'create_role', { ...args, name: 'something-else' }),
    );
    expect(other.status).toBe(422);
    expect((await counts(w)).roles).toBe(rolesAfterFirst);
    expect(await rows(w, 'role.create')).toHaveLength(1);
  });

  it('is refused for a duplicate name, and for a role of the built-in admin client named like a capability', async () => {
    const { w, token } = await sessionOf();
    recOf(await stack.call(w, token, 'create_role', { idempotency_key: key(), name: 'auditors' }));
    recOf(await stack.call(w, token, 'create_group', { idempotency_key: key(), name: 'staff' }));
    const before = await counts(w);
    for (const [tool, args] of [
      ['create_role', { name: 'auditors' }],
      ['create_role', { name: 'manage-tenant', client_id: w.adminDbId }],
      ['create_group', { name: 'staff' }],
      ['create_scope', { name: 'profile' }],
    ] as const) {
      const refused = errorOf(
        await stack.call(w, token, tool, { idempotency_key: key(), ...args }),
      );
      expect(refused.status, `${tool} ${JSON.stringify(args)}`).toBe(409);
    }
    expect(await counts(w)).toEqual(before);
  });

  it('is refused by the admin API for a group name with a slash, which a path cannot hold, if a tool let it through', async () => {
    const { w } = await sessionOf();
    const caller = stack.unguardedCaller(w, ['mcp:read', 'mcp:write']);
    const before = await counts(w);
    const res = await caller.call({
      method: 'POST',
      pattern: '/admin/tenants/:tenant/groups',
      params: {},
      query: {},
      body: { name: 'a/b' },
      idempotencyKey: key(),
    });
    expect(res.status).toBe(400);
    expect(await counts(w)).toEqual(before);
  });

  it('is refused for a NUL, a bidirectional control and a name no client could ask for', async () => {
    const { w, token } = await sessionOf();
    const seen = stack.adminSeen.length;
    for (const [tool, args] of [
      ['create_role', { name: 'a\u0000b' }],
      ['create_role', { name: 'a‮b' }],
      ['create_role', { name: 'ok', description: 'a\u0000b' }],
      ['create_group', { name: 'a/b' }],
      ['create_group', { name: 'ok', description: 'a‮b' }],
      ['create_scope', { name: 'read orders' }],
      ['create_scope', { name: 'ok', description_i18n: { en: 'a\u0000b' } }],
    ] as const) {
      const refused = errorOf(
        await stack.call(w, token, tool, { idempotency_key: key(), ...args }),
      );
      expect(refused.type, `${tool} ${JSON.stringify(args)}`).toBe('mcp:invalid_arguments');
    }
    expect(errorOf(await stack.call(w, token, 'create_role', { name: 'no-key' })).type).toBe(
      'mcp:invalid_arguments',
    );
    expect(stack.adminSeen.slice(seen)).toEqual([]);
  });
});

describe('create_role with a client', () => {
  it('names the client in the audit row, since it is one of the fields the agent chose', async () => {
    const { w, token } = await sessionOf();
    const made = recOf(
      await stack.call(w, token, 'create_role', {
        idempotency_key: key(),
        name: 'client-owned',
        client_id: w.agentDbId,
      }),
    );
    expect(made.data.client_id).toBe(w.agentDbId);
    const [row] = await rows(w, 'role.create');
    expect(row?.detail).toEqual({
      name: { after: 'client-owned' },
      client_id: { after: w.agentDbId },
    });
  });
});

describe('update_role_description, update_group_description and the display order', () => {
  it('amend under the etag of a read, and each audit row shows that field alone', async () => {
    const { w, token } = await sessionOf();
    const role = recOf(
      await stack.call(w, token, 'create_role', { idempotency_key: key(), name: 'auditors' }),
    );
    const group = recOf(
      await stack.call(w, token, 'create_group', { idempotency_key: key(), name: 'staff' }),
    );
    const scope = recOf(
      await stack.call(w, token, 'create_scope', { idempotency_key: key(), name: 'orders' }),
    );
    const roleRead = recOf(await stack.call(w, token, 'get_role', { id: role.data.id }));
    const updatedRole = recOf(
      await stack.call(w, token, 'update_role_description', {
        id: role.data.id,
        if_match: roleRead.etag,
        description: 'Reads the audit trail',
      }),
    );
    const groupRead = recOf(await stack.call(w, token, 'get_group', { id: group.data.id }));
    const updatedGroup = recOf(
      await stack.call(w, token, 'update_group_description', {
        id: group.data.id,
        if_match: groupRead.etag,
        description: 'Employees',
      }),
    );
    const scopeRead = recOf(await stack.call(w, token, 'get_scope', { id: scope.data.id }));
    const updatedScope = recOf(
      await stack.call(w, token, 'update_scope_metadata', {
        id: scope.data.id,
        if_match: scopeRead.etag,
        display_order: 3,
      }),
    );
    expect(updatedRole.data.description).toBe('Reads the audit trail');
    expect(updatedGroup.data.description).toBe('Employees');
    expect(updatedScope.data.display_order).toBe(3);
    expect(updatedRole.etag).not.toBe(roleRead.etag);

    const [roleRow, ...r1] = await rows(w, 'role.amend');
    const [groupRow, ...r2] = await rows(w, 'group.amend');
    const scopeRows = await rows(w, 'scope.amend');
    expect([r1.length, r2.length, scopeRows.length]).toEqual([0, 0, 1]);
    expect(roleRow?.detail).toEqual({
      description: { before: null, after: 'Reads the audit trail' },
    });
    expect(groupRow?.detail).toEqual({ description: { before: null, after: 'Employees' } });
    expect(scopeRows[0]?.detail).toEqual({ display_order: { before: 0, after: 3 } });
    for (const row of [roleRow, groupRow, scopeRows[0]]) {
      expect(row).toMatchObject({
        outcome: 'allowed',
        actorSubjectId: w.subjectId,
        actorClientId: w.agentDbId,
      });
    }
  });

  it('answer a stale etag as a 412 that says to read again, and change nothing', async () => {
    const { w, token } = await sessionOf();
    const role = recOf(
      await stack.call(w, token, 'create_role', { idempotency_key: key(), name: 'auditors' }),
    );
    const group = recOf(
      await stack.call(w, token, 'create_group', { idempotency_key: key(), name: 'staff' }),
    );
    for (const [tool, id, etag] of [
      ['update_role_description', role.data.id, role.etag],
      ['update_group_description', group.data.id, group.etag],
    ] as const) {
      recOf(await stack.call(w, token, tool, { id, if_match: etag, description: 'first' }));
      const stale = errorOf(
        await stack.call(w, token, tool, { id, if_match: etag, description: 'second' }),
      );
      expect(stale).toMatchObject({ status: 412, title: 'Precondition Failed' });
      expect(stale.detail).toMatch(/read it again/iu);
    }
    const read = recOf(await stack.call(w, token, 'get_role', { id: role.data.id }));
    expect(read.data.description).toBe('first');
  });

  it('refuse a name, a default flag and a parent in the arguments, asking the admin API nothing', async () => {
    const { w, token } = await sessionOf();
    const id = newId();
    const etag = `"${'0'.repeat(64)}"`;
    const seen = stack.adminSeen.length;
    for (const [tool, extra] of [
      ['update_role_description', { name: 'renamed' }],
      ['update_role_description', { default_for_new_subjects: true }],
      ['update_group_description', { parent_id: id }],
      ['update_group_description', { name: 'renamed' }],
      ['update_scope_metadata', { consent_text: 'agree to everything' }],
      ['update_scope_metadata', { include_in_id_token: false }],
    ] as const) {
      const result = await stack.call(w, token, tool, {
        id,
        if_match: etag,
        description: 'x',
        ...extra,
      });
      expect(errorOf(result).type, tool).toBe('mcp:invalid_arguments');
    }
    expect(stack.adminSeen.slice(seen)).toEqual([]);
  });
});

describe('what the token and its owner decide', () => {
  const ARGS: Record<string, Record<string, unknown>> = {
    create_role: { idempotency_key: 'k-1', name: 'auditors' },
    create_group: { idempotency_key: 'k-1', name: 'staff' },
    create_scope: { idempotency_key: 'k-1', name: 'orders' },
    update_role_description: { id: newId(), if_match: `"${'0'.repeat(64)}"`, description: 'x' },
    update_group_description: { id: newId(), if_match: `"${'0'.repeat(64)}"`, description: 'x' },
  };

  it('refuses every tool to a read token, at the admin API itself when this layer lets it through', async () => {
    const { w } = await sessionOf();
    const before = await counts(w);
    for (const [tool, args] of Object.entries(ARGS)) {
      const result = await stack.runUnguarded(w, ['mcp:read'], tool, args);
      expect(errorOf(result), tool).toMatchObject({
        status: 403,
        detail: expect.stringMatching(/^insufficient_scope/u) as unknown,
      });
    }
    expect(await counts(w)).toEqual(before);
    const refusals = await rows(w, 'capability.refused');
    expect(refusals).toHaveLength(Object.keys(ARGS).length);
    for (const row of refusals) {
      expect(row).toMatchObject({
        outcome: 'refused',
        actorClientId: w.agentDbId,
        detail: { reason: 'insufficient_scope' },
      });
    }
  });

  it('refuses every tool by name to a read token, and the row says it was refused for its scope', async () => {
    const { w } = await sessionOf();
    const token = await stack.sign(w, 'mcp:read');
    for (const [tool, args] of Object.entries(ARGS)) {
      expect(errorOf(await stack.call(w, token, tool, args)), tool).toMatchObject({
        type: 'mcp:insufficient_scope',
        status: 403,
      });
    }
    const calls = await rows(w, 'agent.tool_call');
    expect(calls).toHaveLength(Object.keys(ARGS).length);
    for (const row of calls) {
      expect(row).toMatchObject({ outcome: 'refused', detail: { reason: 'insufficient_scope' } });
    }
  });

  it('refuses an owner who lacks manage-tenant, by the admin API, and records it', async () => {
    const { w, token } = await sessionOf(['view-audit', 'manage-clients']);
    const before = await counts(w);
    for (const [tool, args] of Object.entries(ARGS)) {
      expect(errorOf(await stack.call(w, token, tool, args)), tool).toMatchObject({ status: 403 });
    }
    expect(await counts(w)).toEqual(before);
    const refusals = await rows(w, 'capability.refused');
    expect(refusals).toHaveLength(Object.keys(ARGS).length);
    for (const row of refusals) {
      expect(row).toMatchObject({
        outcome: 'refused',
        actorSubjectId: w.subjectId,
        actorClientId: w.agentDbId,
        detail: { capability: 'manage-tenant', reason: 'missing_capability' },
      });
    }
    for (const action of ['role.create', 'group.create', 'scope.create', 'role.amend']) {
      expect(await rows(w, action), action).toEqual([]);
    }
  });

  it('lists the five tools, hinted, to a write token whose owner holds manage-tenant, and to no read token', async () => {
    const { w } = await sessionOf();
    const list = async (token: string) => {
      const res = await stack.send(w, token, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {},
      });
      return (res.json().result as { tools: { name: string; annotations: unknown }[] }).tools;
    };
    const names = Object.keys(ARGS);
    const write = (await list(await stack.sign(w, 'mcp:write'))).filter((t) =>
      names.includes(t.name),
    );
    expect(write.map((t) => t.name).sort()).toEqual([...names].sort());
    for (const tool of write) {
      expect(tool.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: !tool.name.startsWith('create_'),
      });
    }
    expect((await list(await stack.sign(w, 'mcp:read'))).some((t) => names.includes(t.name))).toBe(
      false,
    );
    const clientsOnly = await stack.world(['manage-clients'], WRITE);
    const listed = await stack.send(clientsOnly, await stack.sign(clientsOnly, 'mcp:write'), {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    });
    const seen = (listed.json().result as { tools: { name: string }[] }).tools.map((t) => t.name);
    expect(seen.filter((n) => names.includes(n))).toEqual([]);
  });
});

describe('a body sent past the tool', () => {
  it('is refused for every field outside the allowlist, six bodies to a route, and nothing changes', async () => {
    const { w, token } = await sessionOf();
    const role = recOf(
      await stack.call(w, token, 'create_role', { idempotency_key: key(), name: 'auditors' }),
    );
    const group = recOf(
      await stack.call(w, token, 'create_group', { idempotency_key: key(), name: 'staff' }),
    );
    const scope = recOf(
      await stack.call(w, token, 'create_scope', { idempotency_key: key(), name: 'orders' }),
    );
    const caller = stack.unguardedCaller(w, ['mcp:read', 'mcp:write']);
    const other = newId();
    const T = '/admin/tenants/:tenant';
    const table: [
      string,
      string,
      string | undefined,
      string | undefined,
      Record<string, unknown>[],
    ][] = [
      [
        'POST',
        `${T}/roles`,
        undefined,
        undefined,
        [
          { name: 'r', default_for_new_subjects: true },
          { name: 'r', default_for_new_subjects: false },
          { name: 'r', client_id: other, default_for_new_subjects: true },
          { name: 'r', composites: [other] },
          { name: 'r', admin_reach: ['manage-tenant'] },
          { name: 'r', id: other },
        ],
      ],
      [
        'PATCH',
        `${T}/roles/:id`,
        role.data.id,
        role.etag,
        [
          { name: 'renamed' },
          { default_for_new_subjects: true },
          { description: 'd', client_id: other },
          { description: 'd', name: 'x' },
          { composites: [other] },
          { description: 'd', parent_id: other },
        ],
      ],
      [
        'POST',
        `${T}/groups`,
        undefined,
        undefined,
        [
          { name: 'g', parent_id: other },
          { name: 'g', parent_id: null },
          { name: 'g', description: 'd', parent_id: other },
          { name: 'g', default_for_new_subjects: true },
          { name: 'g', role_ids: [other] },
          { name: 'g', path: '/g' },
        ],
      ],
      [
        'PATCH',
        `${T}/groups/:id`,
        group.data.id,
        group.etag,
        [
          { parent_id: other },
          { parent_id: null },
          { name: 'renamed' },
          { default_for_new_subjects: true },
          { description: 'd', path: '/x' },
          { role_ids: [other] },
        ],
      ],
      [
        'POST',
        `${T}/scopes`,
        undefined,
        undefined,
        [
          { name: 's', consent_text: 'agree to all' },
          { name: 's', consent_text_i18n: { en: 'x' } },
          { name: 's', include_in_id_token: true },
          { name: 's', include_in_access_token: true },
          { name: 's', default_client_assignment: 'default' },
          { name: 's', description: 'd', consent_text: 'x', display_order: 1 },
        ],
      ],
      [
        'PATCH',
        `${T}/scopes/:id`,
        scope.data.id,
        scope.etag,
        [
          { consent_text: 'agree' },
          { consent_text_i18n: { en: 'x' } },
          { include_in_id_token: false },
          { include_in_access_token: false },
          { default_client_assignment: 'default' },
          { name: 'renamed' },
        ],
      ],
    ];
    const before = {
      counts: await counts(w),
      amends: [
        await rows(w, 'role.amend'),
        await rows(w, 'group.amend'),
        await rows(w, 'scope.amend'),
      ],
    };
    const rowsOf = (name: string) =>
      withTenant(
        stack.appDb.db,
        w.tenantId,
        async (tx) =>
          (await tx.execute(
            sql.raw(`select to_jsonb(t) as r from ${name} t order by id`),
          )) as unknown,
      );
    const snapshot = JSON.stringify([
      await rowsOf('roles'),
      await rowsOf('groups'),
      await rowsOf('client_scopes'),
    ]);
    let door = 0;
    for (const [method, pattern, id, ifMatch, bodies] of table) {
      expect(bodies).toHaveLength(6);
      for (const body of bodies) {
        const res = await caller.call({
          method: method as 'POST' | 'PATCH',
          pattern,
          params: id === undefined ? {} : { id },
          query: {},
          body: body as never,
          ...(method === 'POST' ? { idempotencyKey: key() } : {}),
          ...(ifMatch === undefined ? {} : { ifMatch }),
        });
        // A create's route shape names some fields and refuses the rest with a 400
        // before the door looks; every member it names, and every member of a
        // PATCH, which takes any, is the door's 403.
        const shape = SHAPES[pattern];
        const named = shape === undefined || Object.keys(body).every((key) => shape.includes(key));
        expect(res.status, `${method} ${pattern} ${JSON.stringify(body)}`).toBe(named ? 403 : 400);
        if (named) {
          expect(res.body).toMatchObject({ detail: 'insufficient_scope' });
          door += 1;
        }
      }
    }
    expect(door).toBe(30);
    expect(await counts(w)).toEqual(before.counts);
    expect(
      JSON.stringify([
        await rowsOf('roles'),
        await rowsOf('groups'),
        await rowsOf('client_scopes'),
      ]),
    ).toBe(snapshot);
    expect([
      await rows(w, 'role.amend'),
      await rows(w, 'group.amend'),
      await rows(w, 'scope.amend'),
    ]).toEqual(before.amends);
    expect(await rows(w, 'capability.refused')).toHaveLength(door);
  });
});

describe('what bounds a create', () => {
  it('is the grant: the 11th create is mcp:write_budget, and nothing is made by it', async () => {
    const { w, token } = await sessionOf();
    const made: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      const tool =
        (['create_role', 'create_group', 'create_scope'] as const)[i % 3] ?? 'create_role';
      made.push(
        recOf(await stack.call(w, token, tool, { idempotency_key: key(), name: `n-${String(i)}` }))
          .data.id,
      );
    }
    const before = await counts(w);
    const refused = errorOf(
      await stack.call(w, token, 'create_role', { idempotency_key: key(), name: 'one-too-many' }),
    );
    expect(refused).toMatchObject({ type: 'mcp:write_budget', status: 429 });
    expect(await counts(w)).toEqual(before);
    const calls = await rows(w, 'agent.tool_call');
    expect(calls.at(-1)).toMatchObject({
      outcome: 'refused',
      detail: { tool: 'create_role', reason: 'write_budget' },
    });
    expect(new Set(made).size).toBe(10);
  });

  it('is the scope limit for a scope: a tenant at SCOPE_LIMIT is refused with the admin API’s 409', async () => {
    const { w, token } = await sessionOf();
    const held = (await counts(w)).scopes;
    await withTenant(stack.appDb.db, w.tenantId, async (tx) => {
      const fill = SCOPE_LIMIT - 1 - held;
      const values = Array.from({ length: fill }, (_, i) => ({
        id: newId(),
        tenantId: w.tenantId,
        name: `filler-${String(i)}`,
      }));
      for (let at = 0; at < values.length; at += 250) {
        await tx.insert(clientScopes).values(values.slice(at, at + 250));
      }
    });
    expect((await counts(w)).scopes).toBe(SCOPE_LIMIT - 1);
    recOf(await stack.call(w, token, 'create_scope', { idempotency_key: key(), name: 'the-last' }));
    expect((await counts(w)).scopes).toBe(SCOPE_LIMIT);
    const refused = errorOf(
      await stack.call(w, token, 'create_scope', { idempotency_key: key(), name: 'one-too-many' }),
    );
    expect(refused.status).toBe(409);
    expect(refused.detail).toContain(String(SCOPE_LIMIT));
    expect((await counts(w)).scopes).toBe(SCOPE_LIMIT);
    const total = await withTenant(stack.appDb.db, w.tenantId, (tx) =>
      tx
        .select({ id: clientScopes.id })
        .from(clientScopes)
        .where(eq(clientScopes.name, 'one-too-many')),
    );
    expect(total).toEqual([]);
  });
});

describe('the limits of roles and groups', () => {
  async function fill(w: World, table: 'roles' | 'groups', upTo: number): Promise<void> {
    const have = (await counts(w))[table];
    await withTenant(stack.appDb.db, w.tenantId, async (tx) => {
      await tx.execute(
        table === 'roles'
          ? sql`insert into roles (id, tenant_id, name)
                select gen_random_uuid(), ${w.tenantId}::uuid, 'filler-' || g from generate_series(1, ${upTo - have}) g`
          : sql`insert into groups (id, tenant_id, name, path)
                select gen_random_uuid(), ${w.tenantId}::uuid, 'filler-' || g, '/filler-' || g
                  from generate_series(1, ${upTo - have}) g`,
      );
    });
  }

  it('refuse a role past ROLE_LIMIT with the admin API’s 409, and make the one before it', async () => {
    const { w, token } = await sessionOf();
    await fill(w, 'roles', ROLE_LIMIT - 1);
    recOf(await stack.call(w, token, 'create_role', { idempotency_key: key(), name: 'the-last' }));
    expect((await counts(w)).roles).toBe(ROLE_LIMIT);
    const refused = errorOf(
      await stack.call(w, token, 'create_role', { idempotency_key: key(), name: 'one-too-many' }),
    );
    expect(refused).toMatchObject({
      status: 409,
      detail: `a tenant defines at most ${String(ROLE_LIMIT)} roles`,
    });
    expect((await counts(w)).roles).toBe(ROLE_LIMIT);
  });

  it('refuse a group past GROUP_LIMIT with the admin API’s 409, and make the one before it', async () => {
    const { w, token } = await sessionOf();
    await fill(w, 'groups', GROUP_LIMIT - 1);
    recOf(await stack.call(w, token, 'create_group', { idempotency_key: key(), name: 'the-last' }));
    expect((await counts(w)).groups).toBe(GROUP_LIMIT);
    const refused = errorOf(
      await stack.call(w, token, 'create_group', { idempotency_key: key(), name: 'one-too-many' }),
    );
    expect(refused).toMatchObject({
      status: 409,
      detail: `a tenant defines at most ${String(GROUP_LIMIT)} groups`,
    });
    expect((await counts(w)).groups).toBe(GROUP_LIMIT);
  });
});
