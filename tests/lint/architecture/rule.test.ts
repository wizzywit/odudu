import { describe, expect, it } from 'vitest';
import { checkRule, RULE_IDS } from './rule.ts';

describe('checkRule', () => {
  it('is clean when nothing breaches', () => {
    expect(checkRule('view-no-service', []).errors).toEqual([]);
  });

  it('fails every breach, naming the rule and the file', () => {
    const files = [
      'apps/admin-console/src/pages/clients/ui/List.tsx',
      'apps/docs/src/features/landing/ui/Wrap.tsx',
    ];
    const { errors } = checkRule('view-no-service', files);
    expect(errors).toHaveLength(2);
    files.forEach((file, i) => {
      expect(errors[i]).toContain('view-no-service');
      expect(errors[i]).toContain(file);
    });
  });

  it.each(RULE_IDS)('%s fails a breach in any slice', (id) => {
    const { errors } = checkRule(id, ['apps/docs/src/shared/ui/X.tsx']);
    expect(errors).toHaveLength(1);
  });
});
