import { describe, expect, it } from 'vitest';
import {
  assignmentsOf,
  knownAssignments,
  ownRolesOf,
  roleIdsOf,
  roleOwnerOf,
  roleUnavailableHere,
  heldLines,
  splitRoles,
} from '#/features/subjects/service/roles.ts';

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

describe('a holder in a list of administrators', () => {
  it('says what is held and whether directly, leaving out what another holding carries', () => {
    expect(
      heldLines([
        { name: 'tenant-admin', direct: true },
        { name: 'manage-users', direct: false },
        { name: 'view-users', direct: false },
      ]),
    ).toEqual([{ holding: 'tenant-admin', label: 'Full (tenant-admin)', how: 'directly' }]);
    expect(
      heldLines([
        { name: 'manage-users', direct: true },
        { name: 'view-users', direct: false },
        { name: 'view-audit', direct: false },
      ]),
    ).toEqual([
      { holding: 'manage-users', label: 'manage-users', how: 'directly' },
      { holding: 'view-audit', label: 'view-audit', how: 'through a group or role' },
    ]);
  });
});

describe('the roles the caller holds', () => {
  const roles = {
    status: 'ready',
    data: { items: [{ id: 'r' }] },
    retry: () => undefined,
  } as never;
  const groups = {
    status: 'ready',
    data: { items: [{ path: '/a' }] },
    retry: () => undefined,
  } as never;
  const loading = { status: 'loading' } as const;
  const failed = { status: 'failed', retry: () => undefined } as const;
  const authority = { capabilities: ['view-users'] } as never;

  it('holds nothing here when signed in to another tenant', () => {
    expect(
      ownRolesOf({ member: false, authority: undefined, roles: loading, groups: loading }),
    ).toEqual({
      status: 'ready',
      roles: [],
      groups: [],
    });
  });

  it('waits for whoami, and cannot read without view-users', () => {
    expect(ownRolesOf({ member: true, authority: undefined, roles, groups })).toEqual({
      status: 'loading',
    });
    expect(
      ownRolesOf({ member: true, authority: { capabilities: [] } as never, roles, groups }),
    ).toEqual({ status: 'unknown' });
  });

  it('is unknown once either read failed, loading while either is, and ready with both', () => {
    expect(ownRolesOf({ member: true, authority, roles: failed, groups: loading })).toEqual({
      status: 'unknown',
    });
    expect(ownRolesOf({ member: true, authority, roles, groups: loading })).toEqual({
      status: 'loading',
    });
    expect(ownRolesOf({ member: true, authority, roles, groups })).toEqual({
      status: 'ready',
      roles: [{ id: 'r' }],
      groups: ['/a'],
    });
  });
});

describe('role assignments', () => {
  it('is known by name and client from the held list and the picker alike', () => {
    const known = knownAssignments(
      [{ id: 'r1', name: 'editor', client_key: null }],
      [{ id: 'r2', name: 'reader', client_key: 'web' }],
    );
    expect(assignmentsOf(['r1', 'r2', 'r3'], known)).toEqual([
      { id: 'r1', name: 'editor', client: null },
      { id: 'r2', name: 'reader', client: 'web' },
      { id: 'r3', name: 'r3', client: null },
    ]);
  });

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
    expect(roleIdsOf(['view-audit'], roles)).toEqual({ ids: ['r1'] });
    expect(roleIdsOf(['view-audit', 'manage-keys'], roles)).toEqual({ missing: ['manage-keys'] });
    expect(roleIdsOf([], null)).toEqual({ missing: [] });
  });
});
