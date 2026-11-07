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
      display_order: 4,
    },
    text: ['description'],
    refusal: /built-in scope/u,
  });

  it.each([-1, 1.5, 2_147_483_648, '4', Number.NaN])(
    'refuses the display order %j, which is an integer from 0 to the contract maximum',
    async (display_order) => {
      const caller = respondingWith({});
      const result = await callTool(scopeMetadataTool, caller, {
        id: '0192a0a0-0000-7000-8000-000000000001',
        if_match: ETAG,
        display_order,
      });
      expect(result.isError).toBe(true);
      expect(caller.requests).toHaveLength(0);
    },
  );

  it('changes the display order alone, which is a call that names one field', async () => {
    const caller = respondingWith({});
    await callTool(scopeMetadataTool, caller, {
      id: '0192a0a0-0000-7000-8000-000000000001',
      if_match: ETAG,
      display_order: 0,
    });
    expect(caller.requests[0]?.body).toEqual({ display_order: 0 });
  });

  it('says in its description that the order the consent screen lists scopes in is what it changes', () => {
    expect(scopeMetadataTool.description).toMatch(/display order/u);
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
