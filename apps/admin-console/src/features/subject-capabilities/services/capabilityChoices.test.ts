import { describe, expect, it } from 'vitest';
import {
  capabilityOptions,
  describeHoldings,
  holderFilterOptions,
} from '#/features/subject-capabilities/services/capabilityChoices';

describe('the capabilities offered', () => {
  const held = new Map([
    ['view-audit' as const, { direct: true, through: [] }],
    ['manage-keys' as const, { direct: false, through: ['through group /ops'] }],
  ]);

  it('offers every holding, guarding the one that is the last', () => {
    const options = capabilityOptions({
      tenant: 'acme',
      name: 'ada',
      chosen: [],
      caller: ['view-audit'],
      held,
      guarded: 'view-audit',
      counted: 'tenant-admin',
    });
    expect(options.find((option) => option.id === 'view-audit')?.unavailable).toBe(
      'ada is the only enabled holder of tenant-admin, so acme would be left with nobody holding it. Give it to somebody else first.',
    );
    expect(options.find((option) => option.id === 'manage-keys')).toMatchObject({
      unavailable: 'You do not hold manage-keys, so you cannot give or take it.',
      note: 'Held through group /ops.',
    });
  });

  it('describes the holdings it chose, or none', () => {
    expect(describeHoldings(['view-audit', 'tenant-admin', 'nonsense'])).toBe(
      'view-audit, Full (tenant-admin)',
    );
    expect(describeHoldings([])).toBe('none');
    expect(describeHoldings(3)).toBe('none');
  });

  it('filters by any capability, Full, or each one the tenant offers', () => {
    const options = holderFilterOptions('acme');
    expect(options.slice(0, 2)).toEqual([
      { id: 'any', label: 'Any capability' },
      { id: 'tenant-admin', label: 'Full (tenant-admin)' },
    ]);
    expect(options.some((option) => option.id === 'manage-tenants')).toBe(false);
    expect(holderFilterOptions('system').some((option) => option.id === 'manage-tenants')).toBe(
      true,
    );
  });
});
