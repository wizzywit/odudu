import { describe, expect, it } from 'vitest';
import { ownRolesOf } from '#/pages/subjects/services/ownRoles';

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
