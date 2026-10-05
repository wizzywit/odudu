import type { EffectiveRoleAssignment } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import {
  ADMIN_CLIENT_KEY,
  beyondCaller,
  ceilingOf,
  grantableIn,
  heldCapabilities,
  includedBy,
  isAdminRole,
  provenanceText,
} from '#/shared/service/capabilities.ts';

function role(
  name: string,
  via: EffectiveRoleAssignment['via'],
  clientKey: string | null = ADMIN_CLIENT_KEY,
): EffectiveRoleAssignment {
  return {
    id: `r-${name}`,
    name,
    client_id: clientKey === null ? null : 'c-admin',
    client_key: clientKey,
    via,
  };
}

describe('grantableIn', () => {
  it('offers manage-tenants in system alone', () => {
    expect(grantableIn('acme')).not.toContain('manage-tenants');
    expect(grantableIn('system')).toContain('manage-tenants');
    expect(grantableIn('acme')).toContain('view-audit');
  });
});

describe('isAdminRole', () => {
  it("is a capability or tenant-admin of the built-in admin client, not a tenant role's namesake", () => {
    expect(isAdminRole({ name: 'manage-users', client_key: ADMIN_CLIENT_KEY })).toBe(true);
    expect(isAdminRole({ name: 'tenant-admin', client_key: ADMIN_CLIENT_KEY })).toBe(true);
    expect(isAdminRole({ name: 'tenant-admin', client_key: null })).toBe(false);
    expect(isAdminRole({ name: 'billing', client_key: ADMIN_CLIENT_KEY })).toBe(false);
    expect(isAdminRole({ name: 'manage-users', client_key: 'odudu-admin-x' })).toBe(false);
  });
});

describe('heldCapabilities', () => {
  it('says how each admin capability is held, and leaves other roles out', () => {
    const held = heldCapabilities([
      role('tenant-admin', [{ kind: 'direct' }]),
      role('manage-users', [
        { kind: 'composite', parent_role_id: 'r-tenant-admin', parent_name: 'tenant-admin' },
        { kind: 'group', group_id: 'g1', group_path: '/ops' },
      ]),
      role('billing', [{ kind: 'direct' }], null),
    ]);
    expect(held.get('tenant-admin')).toEqual({ direct: true, through: [] });
    expect(held.get('manage-users')).toEqual({
      direct: false,
      through: ['within tenant-admin', 'through group /ops'],
    });
    expect([...held.keys()]).toEqual(['tenant-admin', 'manage-users']);
  });
});

describe('provenanceText', () => {
  it('names each path', () => {
    expect(provenanceText({ kind: 'direct' })).toBe('directly');
    expect(provenanceText({ kind: 'group', group_id: 'g', group_path: '/a/b' })).toBe(
      'through group /a/b',
    );
    expect(
      provenanceText({ kind: 'composite', parent_role_id: 'r', parent_name: 'auditors' }),
    ).toBe('within auditors');
  });
});

describe('ceilingOf', () => {
  it('refuses to give or take what the caller does not hold', () => {
    expect(ceilingOf('acme', 'manage-keys', ['manage-users', 'view-users'])).toBe(
      'You do not hold manage-keys, so you cannot give or take it.',
    );
    expect(ceilingOf('acme', 'manage-users', ['manage-users'])).toBeNull();
  });

  it('asks every capability Full carries for Full itself', () => {
    expect(ceilingOf('acme', 'tenant-admin', ['manage-users', 'view-users'])).toBe(
      'Full carries capabilities you do not hold, so you cannot give or take it.',
    );
    expect(ceilingOf('acme', 'tenant-admin', grantableIn('acme'))).toBeNull();
    expect(ceilingOf('system', 'tenant-admin', grantableIn('acme'))).not.toBeNull();
  });
});

describe('beyondCaller', () => {
  it('lists what the subject holds that the caller does not', () => {
    expect(beyondCaller(['view-users', 'manage-keys'], ['view-users', 'manage-users'])).toEqual([
      'manage-keys',
    ]);
    expect(beyondCaller(['tenant-admin', 'view-users'], ['view-users'])).toEqual([]);
  });
});

describe('includedBy', () => {
  it('says which chosen capability already carries another', () => {
    expect(includedBy('manage-keys', ['tenant-admin'])).toBe('tenant-admin');
    expect(includedBy('view-users', ['manage-users'])).toBe('manage-users');
    expect(includedBy('view-audit', ['manage-users'])).toBeNull();
    expect(includedBy('tenant-admin', ['tenant-admin'])).toBeNull();
  });
});
