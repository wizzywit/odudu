import { describe, expect, it } from 'vitest';
import type { Holding } from '#/shared/service/capabilities.ts';
import {
  adminRolesBlocked,
  capabilitiesRemoveTenants,
  capabilityOptions,
  describeHoldings,
  heldElsewhere,
  keptOtherwise,
  onlyHolder,
  reachesEveryTenant,
  elsewhereText,
  holderFilterOptions,
} from '#/features/subjects/service/holdings.ts';

describe('the admin capabilities a subject is given', () => {
  const held = new Map([
    ['view-audit' as const, { direct: true, through: [] }],
    ['manage-keys' as const, { direct: false, through: ['through group /ops'] }],
  ]);

  it('counts a capability as kept when a group or another role gives it', () => {
    expect(
      keptOtherwise(
        new Map([['tenant-admin' as const, { direct: true, through: [] }]]),
        'tenant-admin',
      ),
    ).toBe(false);
    expect(
      keptOtherwise(
        new Map([['tenant-admin' as const, { direct: true, through: ['within tenant-admin'] }]]),
        'tenant-admin',
      ),
    ).toBe(false);
    expect(
      keptOtherwise(
        new Map([['tenant-admin' as const, { direct: false, through: ['through group /a'] }]]),
        'tenant-admin',
      ),
    ).toBe(true);
    expect(
      keptOtherwise(
        new Map([['tenant-admin' as const, { direct: false, through: ['through group /a'] }]]),
        'manage-tenants',
      ),
    ).toBe(true);
  });

  it('takes manage-tenants away only in system, when none of what carries it is kept', () => {
    const take = (tenant: string, base: Holding[], chosen: string[], kept: boolean) =>
      capabilitiesRemoveTenants(tenant, base, chosen, kept);
    expect(take('system', ['tenant-admin'], [], false)).toBe(true);
    expect(take('system', ['manage-tenants'], ['view-audit'], false)).toBe(true);
    expect(take('system', ['tenant-admin'], ['manage-tenants'], false)).toBe(false);
    expect(take('system', ['tenant-admin'], [], true)).toBe(false);
    expect(take('acme', ['tenant-admin'], [], false)).toBe(false);
    expect(take('system', ['view-audit'], [], false)).toBe(false);
  });

  it('guards the one holding that would leave the tenant without an enabled holder', () => {
    const count = (n: number, capped = false) =>
      ({
        status: 'ready',
        retry: () => undefined,
        data: { count: n, capped },
      }) as never;
    const base = {
      enabled: true,
      held: new Map([['tenant-admin' as const, { direct: true, through: [] }]]),
      counted: 'tenant-admin' as const,
      holders: count(1),
      keptOtherwise: false,
      chosen: ['tenant-admin'] as Holding[],
    };
    expect(onlyHolder(base)).toBe('tenant-admin');
    expect(onlyHolder({ ...base, enabled: false })).toBeNull();
    expect(onlyHolder({ ...base, holders: count(2) })).toBeNull();
    expect(onlyHolder({ ...base, holders: count(1, true) })).toBeNull();
    expect(onlyHolder({ ...base, holders: { status: 'loading' } })).toBeNull();
    expect(onlyHolder({ ...base, keptOtherwise: true })).toBeNull();
    expect(onlyHolder({ ...base, held: new Map() })).toBeNull();
    const both = new Map([
      ['tenant-admin' as const, { direct: true, through: [] }],
      ['manage-tenants' as const, { direct: true, through: [] }],
    ]);
    expect(
      onlyHolder({
        ...base,
        held: both,
        counted: 'manage-tenants',
        chosen: ['tenant-admin', 'manage-tenants'],
      }),
    ).toBeNull();
    expect(
      onlyHolder({ ...base, held: both, counted: 'manage-tenants', chosen: ['manage-tenants'] }),
    ).toBe('manage-tenants');
  });

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

  it('names what is held only through a group or role, and by which', () => {
    expect(heldElsewhere(held, [])).toEqual([
      { label: 'manage-keys', through: 'through group /ops' },
    ]);
    expect(heldElsewhere(held, ['tenant-admin'])).toEqual([]);
  });

  it('describes the holdings it chose, or none', () => {
    expect(describeHoldings(['view-audit', 'tenant-admin', 'nonsense'])).toBe(
      'view-audit, Full (tenant-admin)',
    );
    expect(describeHoldings([])).toBe('none');
    expect(describeHoldings(3)).toBe('none');
  });

  it('says why nothing can be saved until the admin roles are read', () => {
    expect(adminRolesBlocked('loading', 'x')).toBe('The admin roles are still being read.');
    expect(adminRolesBlocked('failed', 'x')).toBe(
      'The admin roles could not be read, so nothing can be saved.',
    );
    expect(adminRolesBlocked('ready', 'x')).toBe('x');
    expect(adminRolesBlocked('ready', undefined)).toBeUndefined();
  });

  it('says what is held through a group or role, and that only it takes it away', () => {
    expect(
      elsewhereText('ada', [
        { label: 'A', through: 'through g' },
        { label: 'B', through: 'within A' },
      ]),
    ).toBe('A through g and B within A: only that group or role takes it away, on ada’s ');
  });
});

describe('holders of admin capabilities', () => {
  it('reaches every tenant from system by manage-tenants or Full, and from nowhere else', () => {
    const held = (name: string) => [{ name, direct: true }] as never;
    expect(reachesEveryTenant('system', held('manage-tenants'))).toBe(true);
    expect(reachesEveryTenant('system', held('tenant-admin'))).toBe(true);
    expect(reachesEveryTenant('system', held('view-audit'))).toBe(false);
    expect(reachesEveryTenant('acme', held('manage-tenants'))).toBe(false);
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
