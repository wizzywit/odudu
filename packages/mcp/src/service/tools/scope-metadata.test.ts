import { clientScopeSchema } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import { callTool } from '#/service/call-tool';
import { respondingWith } from '#/testing/fake-caller';
import { scopeMetadataTool } from '#/service/tools/scope-metadata';
import { describeWriteTool, ETAG } from '#/testing/write-conformance';

describe('update_scope_metadata', () => {
  describeWriteTool({
    tool: scopeMetadataTool,
    response: clientScopeSchema,
    pattern: '/admin/tenants/:tenant/scopes/:id',
    fields: {
      description: 'Read the orders of the person',
      description_i18n: { de: 'Bestellungen lesen' },
    },
    text: ['description'],
  });

  it('sends an empty description as it is, which the admin API stores apart from null', async () => {
    const caller = respondingWith({});
    await callTool(scopeMetadataTool, caller, {
      id: '0192a0a0-0000-7000-8000-000000000001',
      if_match: ETAG,
      description: '',
    });
    expect(caller.requests).toHaveLength(1);
    expect(caller.requests[0]?.body).toEqual({ description: '' });
  });
});
