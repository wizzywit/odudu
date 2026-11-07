import { groupSchema } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import { callTool } from '#/service/call-tool';
import { respondingWith } from '#/testing/fake-caller';
import {
  createGroupTool,
  groupWriteTools,
  updateGroupDescriptionTool,
} from '#/service/tools/groups-write';
import { describeCreateTool, describeWriteTool, ETAG } from '#/testing/write-conformance';

const ID = '0192a0a0-0000-7000-8000-000000000009';

describe('the group write tools', () => {
  it('are two, a create and an amendment, both for a holder of manage-tenant', () => {
    expect(groupWriteTools.map((tool) => tool.name)).toEqual([
      'create_group',
      'update_group_description',
    ]);
    for (const tool of groupWriteTools) expect(tool.capability).toBe('manage-tenant');
    expect(createGroupTool.routeKey).toBe('POST /admin/tenants/:tenant/groups');
    expect(updateGroupDescriptionTool.routeKey).toBe('PATCH /admin/tenants/:tenant/groups/:id');
  });
});

describeCreateTool({
  tool: createGroupTool,
  response: groupSchema,
  pattern: '/admin/tenants/:tenant/groups',
  fields: { name: 'staff', description: 'Employees' },
  required: ['name'],
  text: ['description'],
  typed: ['name', 'description'],
  forbidden: {
    parent_id: ID,
    default_for_new_subjects: true,
    role_ids: [ID],
    path: '/staff',
    admin_reach: ['manage-tenant'],
  },
});

describe('create_group', () => {
  it('says what a new group is: a root group with no roles and no members', () => {
    expect(createGroupTool.description).toMatch(/grants nothing/u);
    expect(createGroupTool.description).toMatch(/top level/u);
  });

  it('refuses a name with a slash, which a group name cannot hold, before any call', async () => {
    const caller = respondingWith({}, 201);
    for (const name of ['a/b', '/', 'a/']) {
      const result = await callTool(createGroupTool, caller, { idempotency_key: 'k', name });
      expect(result.isError, name).toBe(true);
    }
    expect(caller.requests).toHaveLength(0);
  });
});

describeWriteTool({
  tool: updateGroupDescriptionTool,
  response: groupSchema,
  pattern: '/admin/tenants/:tenant/groups/:id',
  fields: { description: 'Employees' },
  text: ['description'],
  refusal: /group/u,
});

describe('update_group_description', () => {
  it('names its one field, and refuses a parent, a name and a default flag', async () => {
    const caller = respondingWith({});
    for (const extra of [
      { parent_id: ID },
      { parent_id: null },
      { name: 'renamed' },
      { default_for_new_subjects: true },
    ]) {
      const result = await callTool(updateGroupDescriptionTool, caller, {
        id: ID,
        if_match: ETAG,
        description: 'd',
        ...extra,
      });
      expect(result.isError, JSON.stringify(extra)).toBe(true);
    }
    expect(caller.requests).toHaveLength(0);
  });
});
