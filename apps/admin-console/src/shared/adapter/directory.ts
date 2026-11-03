import {
  listClientsResponseSchema,
  listGroupsResponseSchema,
  listRolesResponseSchema,
  listScopesResponseSchema,
} from '@odudu/contracts/admin';
import { countReader, listReader } from '#/shared/adapter/route';

// The lists and counts that more than one feature reads, whichever record
// they sit on; a picker's own list is the same call as the page's.
export const readRolePage = listReader('roles', listRolesResponseSchema);
export const readRoleCount = countReader('roles');
export const readGroupPage = listReader('groups', listGroupsResponseSchema);
export const readScopePage = listReader('scopes', listScopesResponseSchema);
export const readClientPage = listReader('clients', listClientsResponseSchema);
