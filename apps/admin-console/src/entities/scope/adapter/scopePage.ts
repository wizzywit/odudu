import { listScopesResponseSchema } from '@odudu/contracts/admin';
import { listReader } from '#/shared/adapter/route';

export const readScopePage = listReader('scopes', listScopesResponseSchema);
