import { ALPHA_LIMIT, type Alpha } from '@odudu/contracts';

export const mixed = (value: Alpha): number => ALPHA_LIMIT + value.size;
