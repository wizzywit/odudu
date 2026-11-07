import { listLogoutDeliveriesResponseSchema, listMailResponseSchema } from '@odudu/contracts/admin';
import { describe } from 'vitest';
import { describeReadTool } from '#/testing/conformance';
import { mailTools } from '#/service/tools/mail';

function named(name: string) {
  const found = mailTools.find((tool) => tool.name === name);
  if (found === undefined) throw new Error(`no tool ${name}`);
  return found;
}

describe('mail tools', () => {
  describeReadTool({
    tool: named('list_client_logout_deliveries'),
    response: listLogoutDeliveriesResponseSchema,
    pattern: '/admin/tenants/:tenant/clients/:id/logout-deliveries',
    input: { id: '0192a0a0-0000-7000-8000-000000000001' },
    params: { id: '0192a0a0-0000-7000-8000-000000000001' },
    paged: true,
    text: ['items', 0, 'last_error'],
  });
  describeReadTool({
    tool: named('list_mail'),
    response: listMailResponseSchema,
    pattern: '/admin/tenants/:tenant/mail',
    paged: true,
    text: ['items', 0, 'subject'],
  });
});
