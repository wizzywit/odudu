import { countResponseSchema, listAuditResponseSchema } from '@odudu/contracts/admin';
import { describe } from 'vitest';
import { describeReadTool } from '#/testing/conformance';
import { auditTools } from '#/service/tools/audit';

function named(name: string) {
  const found = auditTools.find((tool) => tool.name === name);
  if (found === undefined) throw new Error(`no tool ${name}`);
  return found;
}

describe('audit tools', () => {
  describeReadTool({
    tool: named('list_audit'),
    response: listAuditResponseSchema,
    pattern: '/admin/tenants/:tenant/audit',
    paged: true,
    text: ['items', 0, 'detail', 'note'],
  });
  describeReadTool({
    tool: named('count_audit'),
    response: countResponseSchema,
    pattern: '/admin/tenants/:tenant/audit/count',
  });
});
