import { describe, expect, it } from 'vitest';
import baseline from './inventory.baseline.json' with { type: 'json' };
import { INVENTORY } from './inventory.ts';
import { checkRule, RULE_IDS, type RuleId } from './rule.ts';

const SLICE = 'apps/admin-console/src/pages/clients';
const MIGRATED_FILE = `${SLICE}/ui/List.tsx`;
const OTHER_FILE = 'apps/admin-console/src/pages/audit/ui/Table.tsx';

const options = { migrated: [SLICE], inventory: [OTHER_FILE] };

describe('checkRule', () => {
  it('is clean when only inventoried files breach outside migrated slices', () => {
    expect(checkRule('view-no-service', [OTHER_FILE], options).errors).toEqual([]);
  });

  it('fails a breach inside a migrated slice', () => {
    const { errors } = checkRule('view-no-service', [MIGRATED_FILE, OTHER_FILE], options);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('view-no-service');
    expect(errors[0]).toContain(MIGRATED_FILE);
  });

  it('fails a breach that is not in the inventory', () => {
    const stray = 'apps/admin-console/src/pages/roles/ui/Row.tsx';
    const { errors } = checkRule('view-no-service', [OTHER_FILE, stray], options);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(stray);
    expect(errors[0]).toContain('inventory');
  });

  it('fails an inventory entry that no longer breaches, saying to remove it', () => {
    const { errors } = checkRule('view-no-service', [], options);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(OTHER_FILE);
    expect(errors[0]).toContain('remove it from the inventory');
  });
});

describe('checkRule slice matching', () => {
  it('does not treat a sibling with the same prefix as the migrated slice', () => {
    const sibling = 'apps/admin-console/src/pages/clients-extra/x.ts';
    const { errors } = checkRule('view-no-service', [sibling], {
      migrated: [SLICE],
      inventory: [sibling],
    });
    expect(errors).toEqual([]);
  });

  it('reports the migrated error for a file that is also inventoried', () => {
    const { errors } = checkRule('view-no-service', [MIGRATED_FILE], {
      migrated: [SLICE],
      inventory: [MIGRATED_FILE],
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('migrated slice');
  });
});

describe('the committed inventory', () => {
  it.each(RULE_IDS)('%s inventory may not gain an entry', (id: RuleId) => {
    expect(
      INVENTORY[id].length,
      `${id}: update inventory.baseline.json in the same commit; a shrink lowers the baseline, a growth is never allowed`,
    ).toBe(baseline[id]);
  });

  it('has a baseline for exactly the known rules', () => {
    expect(Object.keys(baseline).sort()).toEqual([...RULE_IDS].sort());
    expect(Object.keys(INVENTORY).sort()).toEqual([...RULE_IDS].sort());
  });
});
