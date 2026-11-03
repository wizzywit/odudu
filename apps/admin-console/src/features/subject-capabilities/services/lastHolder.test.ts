import { describe, expect, it } from 'vitest';
import type { Holding } from '#/shared/lib/services/capabilities';
import { keptOtherwise, onlyHolder } from '#/features/subject-capabilities/services/lastHolder';

describe('the last holder of a capability', () => {
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
});
