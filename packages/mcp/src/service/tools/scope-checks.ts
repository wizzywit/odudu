import { listBuiltinScopesResponseSchema, scopeImpactSchema } from '@odudu/contracts/admin';
import { idField, tenantGet, valueTool } from '#/service/read-tool';

export const scopeCheckTools = [
  valueTool({
    name: 'get_scope_impact',
    description:
      'Counts what deleting one scope would take with it: the clients that carry it and the roles ' +
      'mapped to it, each counted up to a ceiling ("capped" is true past it), and whether it is a ' +
      'built-in scope. It deletes nothing.',
    routeKey: tenantGet('/scopes/:id/impact'),
    capability: 'manage-tenant',
    shape: { id: idField('scope') },
    pathParams: ['id'],
    response: scopeImpactSchema,
  }),
  valueTool({
    name: 'list_builtin_scopes',
    description:
      'Lists the built-in scopes every tenant is given, by name, and whether this tenant has each ' +
      'one. The set is fixed and short, so the answer is not paged.',
    routeKey: tenantGet('/scopes/builtins'),
    capability: 'manage-tenant',
    shape: {},
    response: listBuiltinScopesResponseSchema,
  }),
];
