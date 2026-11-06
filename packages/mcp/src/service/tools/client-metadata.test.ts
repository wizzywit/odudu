import { clientRecordSchema } from '@odudu/contracts/admin';
import { describe } from 'vitest';
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
});
