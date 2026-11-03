import { alphaSchema, type Alpha } from '@odudu/contracts/admin';

export const read = (value: unknown): Alpha => alphaSchema.parse(value);
