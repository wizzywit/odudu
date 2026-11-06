import { countResponseSchema, listRolesResponseSchema, roleSchema } from '@odudu/contracts/admin';
import { describe } from 'vitest';
import { describeReadTool } from '#/testing/conformance';
import { roleTools } from '#/service/tools/roles';

function named(name: string) {
  const found = roleTools.find((tool) => tool.name === name);
  if (found === undefined) throw new Error(`no tool ${name}`);
  return found;
}

describe('roles tools', () => {
  describeReadTool({
    tool: named('list_roles'),
    response: listRolesResponseSchema,
    pattern: '/admin/tenants/:tenant/roles',
    paged: true,
    text: ['items', 0, 'description'],
  });
  describeReadTool({
    tool: named('count_roles'),
    response: countResponseSchema,
    pattern: '/admin/tenants/:tenant/roles/count',
  });
  describeReadTool({
    tool: named('get_role'),
    response: roleSchema,
    pattern: '/admin/tenants/:tenant/roles/:id',
    input: { id: '0192a0a0-0000-7000-8000-000000000001' },
    params: { id: '0192a0a0-0000-7000-8000-000000000001' },
    text: ['name'],
  });
});
