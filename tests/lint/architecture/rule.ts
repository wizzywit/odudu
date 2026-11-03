export const RULE_IDS = [
  'no-service-barrel',
  'no-domain-in-shared',
  'no-sideways-slice',
  'view-no-service',
  'no-adapter-export',
  'contracts-only-in-adapter',
] as const;

// The whole-repo scans parse every console and docs source, which a shard
// sharing the machine takes well over vitest's default five seconds to do.
export const ARCHITECTURE_SCAN_TIMEOUT = 60_000;

export type RuleId = (typeof RULE_IDS)[number];

export function checkRule(id: RuleId, breaches: string[]): { errors: string[] } {
  return { errors: breaches.map((file) => `${id}: ${file} breaches; fix it`) };
}
