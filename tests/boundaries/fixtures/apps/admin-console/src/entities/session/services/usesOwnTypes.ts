import type { Principal } from '../types/principal.js';

export const usesOwnTypes = (principal: Principal): string => principal.name;
