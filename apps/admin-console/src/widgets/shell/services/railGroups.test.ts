import { describe, expect, it } from 'vitest';
import { currentHref, railGroups, systemRecordHref } from '#/widgets/shell/services/railGroups';

describe('the way back to system', () => {
  it('is the tenant’s record under System › Tenants, where it was entered', () => {
    expect(systemRecordHref('acme')).toBe('/console/system/tenants/acme');
    expect(systemRecordHref('a b')).toBe('/console/system/tenants/a%20b');
  });
});

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
      'Agents',
      'Settings',
      'Branding',
      'Email',
      'Domains',
      'Export',
      'Audit trail',
      'Assistant activity',
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

  it('lists Assistant activity only where whoami says the deployment has an assistant and the caller may read it', () => {
    const reader = { capabilities: ['read-assistant-activity'] as const, crossTenant: false };
    const labels = (authority: Parameters<typeof railGroups>[2]) =>
      railGroups('acme', false, authority).flatMap((g) => g.items.map((i) => i.label));
    expect(labels({ ...reader, assistantAvailable: true })).toContain('Assistant activity');
    expect(labels({ ...reader, assistantAvailable: false })).not.toContain('Assistant activity');
    expect(
      labels({ capabilities: ['view-audit'], crossTenant: false, assistantAvailable: true }),
    ).not.toContain('Assistant activity');
  });

  it('lists only what needs nothing while whoami is still being asked', () => {
    const groups = railGroups('acme', false, undefined, true);
    expect(groups.flatMap((g) => g.items.map((i) => i.label))).toEqual(['Overview']);
  });

  it('lists every area when whoami could not answer, since the server decides regardless', () => {
    expect(railGroups('acme', false, undefined, false).flatMap((g) => g.items)).toHaveLength(18);
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
});
