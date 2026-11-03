import { listRolesResponseSchema } from '@odudu/contracts/admin';
import { countReader, listReader } from '#/shared/adapter/route';

// A picker's list is the same call as the roles page's.
export const readRolePage = listReader('roles', listRolesResponseSchema);
export const readRoleCount = countReader('roles');
