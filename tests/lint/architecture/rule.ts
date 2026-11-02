import { INVENTORY } from './inventory.ts';
import { MIGRATED } from './migrated.ts';

export const RULE_IDS = [
  'no-service-barrel',
  'no-domain-in-shared',
  'no-sideways-slice',
  'view-no-service',
  'no-adapter-export',
  'contracts-only-in-adapter',
] as const;

export type RuleId = (typeof RULE_IDS)[number];

interface Options {
  migrated?: readonly string[];
  inventory?: readonly string[];
}

function inSlice(file: string, slice: string): boolean {
  return file === slice || file.startsWith(`${slice}/`);
}

export function checkRule(
  id: RuleId,
  breaches: string[],
  options: Options = {},
): { errors: string[] } {
  const migrated = options.migrated ?? MIGRATED;
  const inventory = new Set(options.inventory ?? INVENTORY[id]);
  const errors: string[] = [];
  for (const file of breaches) {
    if (migrated.some((slice) => inSlice(file, slice))) {
      errors.push(`${id}: ${file} is in a migrated slice and may not breach this rule`);
    } else if (!inventory.has(file)) {
      errors.push(`${id}: ${file} breaches and is not in the inventory; fix it, never add it`);
    }
  }
  const found = new Set(breaches);
  for (const file of inventory) {
    if (!found.has(file)) {
      errors.push(`${id}: ${file} no longer breaches; remove it from the inventory`);
    }
  }
  return { errors };
}
