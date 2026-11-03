import { listMailResponseSchema } from '@odudu/contracts/admin';
import { listReader } from '#/shared/api/adapter/route';

export const readMailPage = listReader('mail', listMailResponseSchema);
