import { describe, expect, it } from 'vitest';
import {
  actsWithSystemAuthority,
  areaHref,
  currentHref,
  OVERVIEW,
  railGroups,
  showsSystemArea,
} from '#/features/shell/service.ts';

const SYSTEM_ADMIN = { tenant: 'system', subjectId: 's0', username: 'root' };
const ACME_ADMIN = { tenant: 'acme', subjectId: 's1', username: 'grace' };
const everything = {
  capabilities: ['manage-tenants', 'view-users'] as const,
  crossTenant: false,
};

describe('the rail', () => {
  it('groups the tenant areas by task, in the order of the information architecture', () => {
    const groups = railGroups('acme', false);
    expect(groups.map((g) => g.heading ?? '')).toEqual([
      '',
      'Identity',
      'Applications',
      'Security',
      'Tenant',
      'Observe',
    ]);
    expect(groups.flatMap((g) => g.items.map((i) => i.label))).toEqual([
      'Overview',
      'Subjects',
      'Groups',
      'Roles',
      'Clients',
      'Scopes',
      'Registration tokens',
      'Sign-in flow',
      'Signing keys',
      'Settings',
      'Email',
      'Import / export',
      'Audit trail',
    ]);
    expect(groups[1]?.items[0]?.href).toBe('/console/acme/subjects');
  });

  it('puts the System area first when it is shown', () => {
    const [system] = railGroups('system', true);
    expect(system?.heading).toBe('System');
    expect(system?.items.map((i) => i.label)).toEqual(['Tenants', 'System administrators']);
  });

  it('lights the area a page sits under, and the overview only on itself', () => {
    const groups = railGroups('system', true);
    expect(currentHref('system', groups, '/console/system/clients/c1')).toBe(
      '/console/system/clients',
    );
    expect(currentHref('system', groups, '/console/system/')).toBe('/console/system');
    expect(currentHref('system', groups, '/console/system/nowhere')).toBeUndefined();
    expect(currentHref('system', groups, '/console/system/clientsx')).toBeUndefined();
  });

  it('links the overview at the tenant itself', () => {
    expect(areaHref('acme', OVERVIEW)).toBe('/console/acme');
  });
});

describe('the System area', () => {
  it('is shown to a system administrator signed in to system', () => {
    expect(showsSystemArea(SYSTEM_ADMIN, 'system', { ...everything })).toBe(true);
  });

  it('is not shown inside another tenant, to a tenant administrator, or without manage-tenants', () => {
    expect(showsSystemArea(SYSTEM_ADMIN, 'acme', everything)).toBe(false);
    expect(showsSystemArea(ACME_ADMIN, 'system', everything)).toBe(false);
    expect(
      showsSystemArea(SYSTEM_ADMIN, 'system', { capabilities: ['view-users'], crossTenant: false }),
    ).toBe(false);
    expect(showsSystemArea(SYSTEM_ADMIN, 'system', undefined)).toBe(false);
  });
});

describe('the system-authority context bar', () => {
  it('shows for a system administrator inside another tenant', () => {
    expect(
      actsWithSystemAuthority(SYSTEM_ADMIN, 'acme', { capabilities: [], crossTenant: true }),
    ).toBe(true);
    expect(actsWithSystemAuthority(SYSTEM_ADMIN, 'acme', undefined)).toBe(true);
  });

  it('does not show in system itself, for a tenant administrator, or once whoami says otherwise', () => {
    expect(actsWithSystemAuthority(SYSTEM_ADMIN, 'system', undefined)).toBe(false);
    expect(actsWithSystemAuthority(ACME_ADMIN, 'acme', undefined)).toBe(false);
    expect(
      actsWithSystemAuthority(SYSTEM_ADMIN, 'acme', { capabilities: [], crossTenant: false }),
    ).toBe(false);
  });
});
