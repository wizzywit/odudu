import { listGrantsResponseSchema } from '@odudu/contracts/admin';
import { describe } from 'vitest';
import { describeReadTool } from '#/testing/conformance';
import { grantTools } from '#/service/tools/grants';

function named(name: string) {
  const found = grantTools.find((tool) => tool.name === name);
  if (found === undefined) throw new Error(`no tool ${name}`);
  return found;
}

describe('grants tools', () => {
  describeReadTool({
    tool: named('list_subject_grants'),
    response: listGrantsResponseSchema,
    pattern: '/admin/tenants/:tenant/subjects/:id/grants',
    input: { id: '0192a0a0-0000-7000-8000-000000000001' },
    params: { id: '0192a0a0-0000-7000-8000-000000000001' },
    paged: true,
    text: ['items', 0, 'client_key'],
  });
});
