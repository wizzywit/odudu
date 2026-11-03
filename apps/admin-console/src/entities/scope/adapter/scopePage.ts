import { listScopesResponseSchema } from '@odudu/contracts/admin';
import { listReader } from '#/shared/api/adapter/route';

export const readScopePage = listReader('scopes', listScopesResponseSchema);
