import { clientRecordSchema } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import { callTool } from '#/service/call-tool';
import { respondingWith } from '#/testing/fake-caller';
import { clientMetadataTool } from '#/service/tools/client-metadata';
import { describeWriteTool } from '#/testing/write-conformance';

describe('update_client_metadata', () => {
  describeWriteTool({
    tool: clientMetadataTool,
    response: clientRecordSchema,
    pattern: '/admin/tenants/:tenant/clients/:id',
    fields: {
      name: 'Billing portal',
      description: 'Where customers pay',
      name_i18n: { de: 'Rechnungsportal' },
      description_i18n: { de: 'Hier zahlen Kunden' },
    },
    text: ['name'],
  });

  it('refuses a NUL or a bidirectional control in a name before any call', async () => {
    const caller = respondingWith({});
    for (const name of ['a\u0000b', 'a\u202Eb', '']) {
      const result = await callTool(clientMetadataTool, caller, {
        id: '0192a0a0-0000-7000-8000-000000000001',
        if_match: `"${'a'.repeat(64)}"`,
        name,
      });
      expect(result.isError).toBe(true);
    }
    expect(caller.requests).toHaveLength(0);
  });
});
