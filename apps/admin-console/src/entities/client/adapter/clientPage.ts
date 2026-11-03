import { listClientsResponseSchema } from '@odudu/contracts/admin';
import { listReader } from '#/shared/api/adapter/route';

export const readClientPage = listReader('clients', listClientsResponseSchema);
