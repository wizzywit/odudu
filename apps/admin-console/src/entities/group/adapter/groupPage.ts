import { listGroupsResponseSchema } from '@odudu/contracts/admin';
import { listReader } from '#/shared/adapter/route';

export const readGroupPage = listReader('groups', listGroupsResponseSchema);
