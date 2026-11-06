import {
  clientScopeSchema,
  countResponseSchema,
  countScopesQuerySchema,
  listScopesResponseSchema,
} from '@odudu/contracts/admin';
import { idField, pageShape, pageTool, tenantGet, valueTool } from '#/service/read-tool';

export const scopeTools = [
  pageTool({
    name: 'list_scopes',
    description:
      'Lists the scopes the tenant defines, one page at a time, with the claims each one releases ' +
      'and the display text shown on the consent screen.',
    routeKey: tenantGet('/scopes'),
    capability: 'manage-tenant',
    shape: { ...countScopesQuerySchema.shape, ...pageShape },
    response: listScopesResponseSchema,
  }),
  valueTool({
    name: 'count_scopes',
    description:
      'Counts the tenant\'s scopes under the same filters as list_scopes; "capped" is true when ' +
      'the real number is larger.',
    routeKey: tenantGet('/scopes/count'),
    capability: 'manage-tenant',
    shape: countScopesQuerySchema.shape,
    response: countResponseSchema,
  }),
  valueTool({
    name: 'get_scope',
    description: 'Reads one scope: its name, description, consent text and claim settings.',
    routeKey: tenantGet('/scopes/:id'),
    capability: 'manage-tenant',
    shape: { id: idField('scope') },
    pathParams: ['id'],
    response: clientScopeSchema,
  }),
];
