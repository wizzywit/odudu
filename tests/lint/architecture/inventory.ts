import type { RuleId } from './rule.ts';

export const INVENTORY: Record<RuleId, string[]> = {
  'no-service-barrel': [],
  'no-domain-in-shared': [],
  'no-sideways-slice': [],
  'view-no-service': [],
  'no-adapter-export': [],
  'contracts-only-in-adapter': [],
};
