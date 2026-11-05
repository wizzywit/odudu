import { describe, expect, it } from 'vitest';
import { areaAt, areaTitled, OVERVIEW } from '#/entities/area/services/areas';

it('finds an area by its path, and refuses one no area has', () => {
  expect(areaAt('audit')).toMatchObject({ label: 'Audit trail', capability: 'view-audit' });
  expect(areaAt('')).toBe(OVERVIEW);
  expect(() => areaAt('nowhere')).toThrow('no area is at "nowhere"');
});

it('titles a page by the menu label of its area, and carries the area', () => {
  const titled = areaTitled('registration-tokens');
  expect(titled.area).toBe(areaAt('registration-tokens'));
  expect(titled.title).toBe('Registration tokens');
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
    ['domains', 'Domains', 'view-domains'],
    ['export', 'Export', 'manage-tenant'],
    ['audit', 'Audit trail', 'view-audit'],
    ['tenants', 'Tenants', 'manage-tenants'],
    ['system-admins', 'System administrators', 'manage-tenants'],
  ] as const)('%j is %s and needs %s', (path, label, capability) => {
    expect(areaAt(path)).toMatchObject({ path, label, capability });
  });
});
