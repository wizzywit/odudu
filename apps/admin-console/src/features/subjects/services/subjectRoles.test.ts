import { describe, expect, it } from 'vitest';
import {
  roleIdsOf,
  roleOwnerOf,
  roleUnavailableHere,
  splitRoles,
} from '#/features/subjects/services/subjectRoles';

describe('roles', () => {
  const assigned = (id: string, name: string, key: string | null) => ({
    id,
    name,
    client_id: key === null ? null : `c-${key}`,
    client_key: key,
  });

  it('tells the admin capabilities apart from every other role', () => {
    expect(
      splitRoles([
        assigned('r1', 'billing', null),
        assigned('r2', 'manage-users', 'odudu-admin'),
        assigned('r3', 'tenant-admin', 'odudu-admin'),
        assigned('r4', 'tenant-admin', null),
      ]),
    ).toEqual({
      roleIds: ['r1', 'r4'],
      adminIds: ['r2', 'r3'],
      holdings: ['tenant-admin', 'manage-users'],
    });
  });
});

describe('role assignments', () => {
  it('keeps an admin capability out of the plain role picker, and says where it is set', () => {
    expect(roleUnavailableHere({ name: 'manage-keys', client_key: 'odudu-admin' })).toBe(
      'an admin capability: set it under Admin capabilities',
    );
    expect(roleUnavailableHere({ name: 'editor', client_key: null })).toBeNull();
  });

  it('says whose a directly held role is', () => {
    expect(roleOwnerOf(null)).toBe('tenant role');
    expect(roleOwnerOf('web')).toBe('client web');
  });
});

describe('the admin capabilities a subject is given', () => {
  it('names a role id for each holding, or the holdings that have none', () => {
    const roles = new Map([['view-audit' as const, 'r1']]);
    const read = { status: 'ready' as const, data: roles };
    expect(roleIdsOf(['view-audit'], read)).toEqual({ ids: ['r1'] });
    expect(roleIdsOf(['view-audit', 'manage-keys'], read)).toEqual({ missing: ['manage-keys'] });
    expect(roleIdsOf([], { status: 'loading' })).toEqual({ missing: [] });
    expect(roleIdsOf(['view-audit'], { status: 'loading' })).toEqual({ missing: ['view-audit'] });
  });
});
