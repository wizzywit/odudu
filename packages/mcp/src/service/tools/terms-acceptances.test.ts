import { listTermsAcceptancesResponseSchema } from '@odudu/contracts/admin';
import { describe } from 'vitest';
import { describeReadTool } from '#/testing/conformance';
import { termsAcceptanceTools } from '#/service/tools/terms-acceptances';

function named(name: string) {
  const found = termsAcceptanceTools.find((tool) => tool.name === name);
  if (found === undefined) throw new Error(`no tool ${name}`);
  return found;
}

describe('terms acceptance tools', () => {
  describeReadTool({
    tool: named('list_subject_terms_acceptances'),
    response: listTermsAcceptancesResponseSchema,
    pattern: '/admin/tenants/:tenant/subjects/:id/terms-acceptances',
    input: { id: '0192a0a0-0000-7000-8000-000000000001' },
    params: { id: '0192a0a0-0000-7000-8000-000000000001' },
    paged: true,
    text: ['items', 0, 'version'],
  });
});
