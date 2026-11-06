import {
  clientScopeSchema,
  countResponseSchema,
  countScopesQuerySchema,
  listScopeClientsResponseSchema,
  listScopesResponseSchema,
  scopeMappersSchema,
  setScopeRolesResponseSchema,
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
    description:
      'Reads one scope: its name, description, consent text and claim settings. The etag ' +
      'beside data is the if_match of update_scope_metadata.',
    routeKey: tenantGet('/scopes/:id'),
    capability: 'manage-tenant',
    shape: { id: idField('scope') },
    pathParams: ['id'],
    response: clientScopeSchema,
    etag: true,
  }),
  valueTool({
    name: 'get_scope_roles',
    description: 'Lists the roles a scope is limited to: only a holder of one is released it.',
    routeKey: tenantGet('/scopes/:id/roles'),
    capability: 'manage-tenant',
    shape: { id: idField('scope') },
    pathParams: ['id'],
    response: setScopeRolesResponseSchema,
  }),
  valueTool({
    name: 'get_scope_mappers',
    description:
      'Says which claim mappers a scope uses ("bound"), which exist ("available") and which it ' +
      'declares ("declared"): what decides the claims a token carries for the scope.',
    routeKey: tenantGet('/scopes/:id/mappers'),
    capability: 'manage-tenant',
    shape: { id: idField('scope') },
    pathParams: ['id'],
    response: scopeMappersSchema,
  }),
  pageTool({
    name: 'list_scope_clients',
    description:
      'Lists the clients a scope is assigned to and how (default or optional), one page at a time.',
    routeKey: tenantGet('/scopes/:id/clients'),
    capability: 'manage-tenant',
    shape: { id: idField('scope'), ...pageShape },
    pathParams: ['id'],
    response: listScopeClientsResponseSchema,
  }),
];
