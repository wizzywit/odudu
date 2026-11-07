import { roleSchema } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import { callTool } from '#/service/call-tool';
import { respondingWith } from '#/testing/fake-caller';
import {
  createRoleTool,
  roleWriteTools,
  updateRoleDescriptionTool,
} from '#/service/tools/roles-write';
import { describeCreateTool, describeWriteTool, ETAG } from '#/testing/write-conformance';

const CLIENT = '0192a0a0-0000-7000-8000-000000000009';

describe('the role write tools', () => {
  it('are two, a create and an amendment, both for a holder of manage-tenant', () => {
    expect(roleWriteTools.map((tool) => tool.name)).toEqual([
      'create_role',
      'update_role_description',
    ]);
    for (const tool of roleWriteTools) expect(tool.capability).toBe('manage-tenant');
    expect(createRoleTool.routeKey).toBe('POST /admin/tenants/:tenant/roles');
    expect(updateRoleDescriptionTool.routeKey).toBe('PATCH /admin/tenants/:tenant/roles/:id');
  });
});

describeCreateTool({
  tool: createRoleTool,
  response: roleSchema,
  pattern: '/admin/tenants/:tenant/roles',
  fields: { name: 'auditors', description: 'Reads the audit trail', client_id: CLIENT },
  required: ['name'],
  text: ['description'],
  typed: ['name', 'description'],
  forbidden: {
    default_for_new_subjects: true,
    parent_id: CLIENT,
    composites: [CLIENT],
    admin_reach: ['manage-tenant'],
    client_key: 'portal',
  },
});

describe('create_role', () => {
  it('says in its description what a new role is: empty, held by nobody, a default for no one', () => {
    expect(createRoleTool.description).toMatch(/grants nothing/u);
    expect(createRoleTool.description).toMatch(/nobody holds/u);
  });

  it('refuses a client_id that is not a UUID and a description past the cap', async () => {
    const caller = respondingWith({}, 201);
    for (const body of [
      { client_id: '../x' },
      { client_id: 7 },
      { client_id: `${CLIENT}/..` },
      { description: 'x'.repeat(1_001) },
    ]) {
      const result = await callTool(createRoleTool, caller, {
        idempotency_key: 'k',
        name: 'auditors',
        ...body,
      });
      expect(result.isError, JSON.stringify(body)).toBe(true);
    }
    expect(caller.requests).toHaveLength(0);
  });

  it('takes a null description, which the admin API stores as none', async () => {
    const caller = respondingWith({}, 201);
    await callTool(createRoleTool, caller, { idempotency_key: 'k', name: 'a', description: null });
    expect(caller.requests[0]?.body).toEqual({ name: 'a', description: null });
  });
});

describeWriteTool({
  tool: updateRoleDescriptionTool,
  response: roleSchema,
  pattern: '/admin/tenants/:tenant/roles/:id',
  fields: { description: 'Reads the audit trail' },
  text: ['description'],
  refusal: /role/u,
});

describe('update_role_description', () => {
  it('names its one field, and refuses a name, a default flag and a client', async () => {
    const caller = respondingWith({});
    for (const extra of [
      { name: 'renamed' },
      { default_for_new_subjects: true },
      { client_id: CLIENT },
      { composites: [] },
    ]) {
      const result = await callTool(updateRoleDescriptionTool, caller, {
        id: CLIENT,
        if_match: ETAG,
        description: 'd',
        ...extra,
      });
      expect(result.isError, JSON.stringify(extra)).toBe(true);
    }
    expect(caller.requests).toHaveLength(0);
  });

  it('sends an empty description as it is, and null to clear it', async () => {
    const caller = respondingWith({});
    for (const description of ['', null]) {
      await callTool(updateRoleDescriptionTool, caller, {
        id: CLIENT,
        if_match: ETAG,
        description,
      });
    }
    expect(caller.requests.map((r) => r.body)).toEqual([
      { description: '' },
      { description: null },
    ]);
  });
});
