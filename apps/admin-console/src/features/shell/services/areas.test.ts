import { describe, expect, it } from 'vitest';
import { areaAt, OVERVIEW } from '#/features/shell/services/areas';
import { areaHref, currentHref, railGroups } from '#/features/shell/services/rail';

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
      'Sessions',
      'Settings',
      'Branding',
      'Email',
      'Export',
      'Audit trail',
    ]);
    expect(groups[1]?.items[0]?.href).toBe('/console/acme/subjects');
  });

  it('lists only the areas whoami says the caller can read, leaving out an empty group', () => {
    const viewer = { capabilities: ['view-users', 'view-audit'] as const, crossTenant: false };
    const groups = railGroups('acme', false, viewer);
    expect(groups.map((g) => g.heading ?? '')).toEqual(['', 'Identity', 'Observe']);
    expect(groups.flatMap((g) => g.items.map((i) => i.label))).toEqual([
      'Overview',
      'Subjects',
      'Audit trail',
    ]);
  });

  it('lists only what needs nothing while whoami is still being asked', () => {
    const groups = railGroups('acme', false, undefined, true);
    expect(groups.flatMap((g) => g.items.map((i) => i.label))).toEqual(['Overview']);
  });

  it('lists every area when whoami could not answer, since the server decides regardless', () => {
    expect(railGroups('acme', false, undefined, false).flatMap((g) => g.items)).toHaveLength(15);
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

  it('lights Tenants on the pages that belong to it beside the list', () => {
    const groups = railGroups('system', true);
    for (const page of [
      'new-tenant',
      'import-tenant',
      'tenants/acme',
      'tenants/acme/new-administrator',
    ]) {
      expect(currentHref('system', groups, `/console/system/${page}`), page).toBe(
        '/console/system/tenants',
      );
    }
    expect(currentHref('system', groups, '/console/system/system-admins/new')).toBe(
      '/console/system/system-admins',
    );
    expect(currentHref('system', groups, '/console/system/new-tenantx')).toBeUndefined();
  });

  it('links the overview at the tenant itself', () => {
    expect(areaHref('acme', OVERVIEW)).toBe('/console/acme');
    expect(areaHref('system', OVERVIEW)).toBe('/console/system');
  });
});

it('finds an area by its path, and refuses one no area has', () => {
  expect(areaAt('audit')).toMatchObject({ label: 'Audit trail', capability: 'view-audit' });
  expect(areaAt('')).toBe(OVERVIEW);
  expect(() => areaAt('nowhere')).toThrow('no area is at "nowhere"');
});

describe('the areas', () => {
  it.each([
    ['', 'Overview', null],
    ['subjects', 'Subjects', 'view-users'],
    ['groups', 'Groups', 'manage-tenant'],
    ['roles', 'Roles', 'manage-tenant'],
    ['clients', 'Clients', 'manage-clients'],
    ['scopes', 'Scopes', 'manage-tenant'],
    ['registration-tokens', 'Registration tokens', 'manage-clients'],
    ['flow', 'Sign-in flow', 'manage-tenant'],
    ['keys', 'Signing keys', 'manage-keys'],
    ['sessions', 'Sessions', 'manage-sessions'],
    ['settings', 'Settings', 'manage-tenant'],
    ['branding', 'Branding', 'manage-tenant'],
    ['email', 'Email', 'manage-tenant'],
    ['export', 'Export', 'manage-tenant'],
    ['audit', 'Audit trail', 'view-audit'],
    ['tenants', 'Tenants', 'manage-tenants'],
    ['system-admins', 'System administrators', 'manage-tenants'],
  ] as const)('%j is %s and needs %s', (path, label, capability) => {
    expect(areaAt(path)).toMatchObject({ path, label, capability });
  });
});

describe('where an area lives', () => {
  it.each([
    ['registration-tokens', '/console/a%20b/registration-tokens'],
    ['sessions', '/console/a%20b/sessions'],
    ['tenants', '/console/a%20b/tenants'],
  ] as const)('%s is under the tenant, its name encoded', (path, href) => {
    expect(areaHref('a b', areaAt(path))).toBe(href);
  });
});
