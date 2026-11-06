import { domainSchema, listDomainsResponseSchema } from '@odudu/contracts/admin';
import { describe } from 'vitest';
import { describeReadTool } from '#/testing/conformance';
import { domainTools } from '#/service/tools/domains';

function named(name: string) {
  const found = domainTools.find((tool) => tool.name === name);
  if (found === undefined) throw new Error(`no tool ${name}`);
  return found;
}

describe('domains tools', () => {
  describeReadTool({
    tool: named('list_domains'),
    response: listDomainsResponseSchema,
    pattern: '/admin/tenants/:tenant/domains',
    paged: true,
    text: ['items', 0, 'host'],
  });
  describeReadTool({
    tool: named('get_domain'),
    response: domainSchema,
    pattern: '/admin/tenants/:tenant/domains/:id',
    input: { id: '0192a0a0-0000-7000-8000-000000000001' },
    params: { id: '0192a0a0-0000-7000-8000-000000000001' },
    text: ['host'],
  });
});
