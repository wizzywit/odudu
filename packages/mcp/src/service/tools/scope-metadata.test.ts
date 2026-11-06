import { clientScopeSchema } from '@odudu/contracts/admin';
import { describe } from 'vitest';
import { scopeMetadataTool } from '#/service/tools/scope-metadata';
import { describeWriteTool } from '#/testing/write-conformance';

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
});
