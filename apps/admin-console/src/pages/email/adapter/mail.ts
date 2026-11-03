import { listMailResponseSchema } from '@odudu/contracts/admin';
import { listReader } from '#/shared/adapter/route';

export const readMailPage = listReader('mail', listMailResponseSchema);
