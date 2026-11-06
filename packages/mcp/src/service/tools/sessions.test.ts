import {
  countResponseSchema,
  listSessionsResponseSchema,
  listTenantSessionsResponseSchema,
} from '@odudu/contracts/admin';
import { describe } from 'vitest';
import { describeReadTool } from '#/testing/conformance';
import { sessionTools } from '#/service/tools/sessions';

function named(name: string) {
  const found = sessionTools.find((tool) => tool.name === name);
  if (found === undefined) throw new Error(`no tool ${name}`);
  return found;
}

describe('sessions tools', () => {
  describeReadTool({
    tool: named('list_client_sessions'),
    response: listTenantSessionsResponseSchema,
    pattern: '/admin/tenants/:tenant/clients/:id/sessions',
    input: { id: '0192a0a0-0000-7000-8000-000000000001' },
    params: { id: '0192a0a0-0000-7000-8000-000000000001' },
    paged: true,
    text: ['items', 0, 'username'],
  });
  describeReadTool({
    tool: named('list_sessions'),
    response: listTenantSessionsResponseSchema,
    pattern: '/admin/tenants/:tenant/sessions',
    paged: true,
    text: ['items', 0, 'username'],
  });
  describeReadTool({
    tool: named('count_sessions'),
    response: countResponseSchema,
    pattern: '/admin/tenants/:tenant/sessions/count',
  });
  describeReadTool({
    tool: named('list_subject_sessions'),
    response: listSessionsResponseSchema,
    pattern: '/admin/tenants/:tenant/subjects/:id/sessions',
    input: { id: '0192a0a0-0000-7000-8000-000000000001' },
    params: { id: '0192a0a0-0000-7000-8000-000000000001' },
    paged: true,
  });
});
