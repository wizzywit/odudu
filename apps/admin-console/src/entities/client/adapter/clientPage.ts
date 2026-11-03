import { listClientsResponseSchema } from '@odudu/contracts/admin';
import { listReader } from '#/shared/adapter/route';

export const readClientPage = listReader('clients', listClientsResponseSchema);
