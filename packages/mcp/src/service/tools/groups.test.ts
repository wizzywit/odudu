import {
  countResponseSchema,
  groupSchema,
  listGroupsResponseSchema,
  setGroupRolesResponseSchema,
} from '@odudu/contracts/admin';
import { describe } from 'vitest';
import { describeReadTool } from '#/testing/conformance';
import { groupTools } from '#/service/tools/groups';

function named(name: string) {
  const found = groupTools.find((tool) => tool.name === name);
  if (found === undefined) throw new Error(`no tool ${name}`);
  return found;
}

describe('groups tools', () => {
  describeReadTool({
    tool: named('list_groups'),
    response: listGroupsResponseSchema,
    pattern: '/admin/tenants/:tenant/groups',
    paged: true,
    text: ['items', 0, 'description'],
  });
  describeReadTool({
    tool: named('count_groups'),
    response: countResponseSchema,
    pattern: '/admin/tenants/:tenant/groups/count',
  });
  describeReadTool({
    tool: named('get_group'),
    response: groupSchema,
    pattern: '/admin/tenants/:tenant/groups/:id',
    input: { id: '0192a0a0-0000-7000-8000-000000000001' },
    params: { id: '0192a0a0-0000-7000-8000-000000000001' },
    text: ['name'],
  });
  describeReadTool({
    tool: named('get_group_roles'),
    response: setGroupRolesResponseSchema,
    pattern: '/admin/tenants/:tenant/groups/:id/roles',
    input: { id: '0192a0a0-0000-7000-8000-000000000001' },
    params: { id: '0192a0a0-0000-7000-8000-000000000001' },
  });
});
