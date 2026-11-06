import {
  countGroupsQuerySchema,
  countResponseSchema,
  groupSchema,
  listGroupsResponseSchema,
  setGroupRolesResponseSchema,
} from '@odudu/contracts/admin';
import { idField, pageShape, pageTool, tenantGet, valueTool } from '#/service/read-tool';

export const groupTools = [
  pageTool({
    name: 'list_groups',
    description: "Lists the tenant's groups, one page at a time, optionally filtered.",
    routeKey: tenantGet('/groups'),
    capability: 'manage-tenant',
    shape: { ...countGroupsQuerySchema.shape, ...pageShape },
    response: listGroupsResponseSchema,
  }),
  valueTool({
    name: 'count_groups',
    description:
      'Counts the tenant\'s groups under the same filters as list_groups; "capped" is true when ' +
      'the real number is larger.',
    routeKey: tenantGet('/groups/count'),
    capability: 'manage-tenant',
    shape: countGroupsQuerySchema.shape,
    response: countResponseSchema,
  }),
  valueTool({
    name: 'get_group',
    description: 'Reads one group: its name, description and parent.',
    routeKey: tenantGet('/groups/:id'),
    capability: 'manage-tenant',
    shape: { id: idField('group') },
    pathParams: ['id'],
    response: groupSchema,
  }),
  valueTool({
    name: 'get_group_roles',
    description: 'Lists the roles a group grants to its members.',
    routeKey: tenantGet('/groups/:id/roles'),
    capability: 'manage-tenant',
    shape: { id: idField('group') },
    pathParams: ['id'],
    response: setGroupRolesResponseSchema,
  }),
];
