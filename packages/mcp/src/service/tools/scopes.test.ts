import {
  clientScopeSchema,
  countResponseSchema,
  listScopesResponseSchema,
} from '@odudu/contracts/admin';
import { describe } from 'vitest';
import { describeReadTool } from '#/testing/conformance';
import { scopeTools } from '#/service/tools/scopes';

function named(name: string) {
  const found = scopeTools.find((tool) => tool.name === name);
  if (found === undefined) throw new Error(`no tool ${name}`);
  return found;
}

describe('scopes tools', () => {
  describeReadTool({
    tool: named('list_scopes'),
    response: listScopesResponseSchema,
    pattern: '/admin/tenants/:tenant/scopes',
    paged: true,
    text: ['items', 0, 'description'],
  });
  describeReadTool({
    tool: named('count_scopes'),
    response: countResponseSchema,
    pattern: '/admin/tenants/:tenant/scopes/count',
  });
  describeReadTool({
    tool: named('get_scope'),
    response: clientScopeSchema,
    pattern: '/admin/tenants/:tenant/scopes/:id',
    input: { id: '0192a0a0-0000-7000-8000-000000000001' },
    params: { id: '0192a0a0-0000-7000-8000-000000000001' },
    text: ['description'],
  });
});
