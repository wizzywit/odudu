import {
  countResponseSchema,
  countRolesQuerySchema,
  listRoleCompositesResponseSchema,
  listRolesResponseSchema,
  roleSchema,
} from '@odudu/contracts/admin';
import { idField, pageShape, pageTool, tenantGet, valueTool } from '#/service/read-tool';

export const roleTools = [
  pageTool({
    name: 'list_roles',
    description: "Lists the tenant's roles, one page at a time, optionally filtered.",
    routeKey: tenantGet('/roles'),
    capability: 'manage-tenant',
    shape: { ...countRolesQuerySchema.shape, ...pageShape },
    response: listRolesResponseSchema,
  }),
  valueTool({
    name: 'count_roles',
    description:
      'Counts the tenant\'s roles under the same filters as list_roles; "capped" is true when ' +
      'the real number is larger.',
    routeKey: tenantGet('/roles/count'),
    capability: 'manage-tenant',
    shape: countRolesQuerySchema.shape,
    response: countResponseSchema,
  }),
  valueTool({
    name: 'get_role',
    description:
      'Reads one role: its name, description and owner. The etag beside data is the if_match of ' +
      'update_role_description.',
    routeKey: tenantGet('/roles/:id'),
    capability: 'manage-tenant',
    shape: { id: idField('role') },
    pathParams: ['id'],
    response: roleSchema,
    etag: true,
  }),
  valueTool({
    name: 'get_role_composites',
    description:
      'Lists the roles nested directly under a role, which anyone holding it also holds.',
    routeKey: tenantGet('/roles/:id/composites'),
    capability: 'manage-tenant',
    shape: { id: idField('role') },
    pathParams: ['id'],
    response: listRoleCompositesResponseSchema,
  }),
];
