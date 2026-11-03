import { listGroupsResponseSchema } from '@odudu/contracts/admin';
import { listReader } from '#/shared/api/adapter/route';

export const readGroupPage = listReader('groups', listGroupsResponseSchema);
