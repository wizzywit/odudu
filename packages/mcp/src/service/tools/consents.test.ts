import { listConsentsResponseSchema } from '@odudu/contracts/admin';
import { describe } from 'vitest';
import { describeReadTool } from '#/testing/conformance';
import { consentTools } from '#/service/tools/consents';

function named(name: string) {
  const found = consentTools.find((tool) => tool.name === name);
  if (found === undefined) throw new Error(`no tool ${name}`);
  return found;
}

describe('consents tools', () => {
  describeReadTool({
    tool: named('list_subject_consents'),
    response: listConsentsResponseSchema,
    pattern: '/admin/tenants/:tenant/subjects/:id/consents',
    input: { id: '0192a0a0-0000-7000-8000-000000000001' },
    params: { id: '0192a0a0-0000-7000-8000-000000000001' },
    paged: true,
    text: ['items', 0, 'client_key'],
  });
});
