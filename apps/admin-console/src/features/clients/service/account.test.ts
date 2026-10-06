import { describe, expect, it } from 'vitest';
import {
  assignedCount,
  assignedRoles,
  nameIndex,
  heldCapabilitiesText,
  roleUnavailable,
  serviceRolesRecord,
  splitAssigned,
} from '#/features/clients/service/account.ts';

const ADMIN = { id: 'a1', name: 'manage-users', client_id: 'ac', client_key: 'odudu-admin' };
const TENANT = { id: 't1', name: 'reader', client_id: null, client_key: null };
const CLIENT = { id: 'c1', name: 'reader', client_id: 'cc', client_key: 'billing' };

describe('the roles of a service account', () => {
  it('is the record the account own page reads', () => {
    expect(serviceRolesRecord('s1')).toBe('subjects/s1/roles');
  });

  it('splits what this tab edits from the admin capabilities every save keeps', () => {
    expect(splitAssigned([ADMIN, TENANT, CLIENT])).toEqual({
      roleIds: ['t1', 'c1'],
      adminIds: ['a1'],
    });
  });

  it('says which capabilities are kept, and nothing when there are none', () => {
    expect(heldCapabilitiesText([TENANT])).toBeNull();
    expect(heldCapabilitiesText([ADMIN])).toMatch(/manage-users/u);
  });

  it('counts the roles in words', () => {
    expect(assignedCount(1)).toBe('1 role assigned.');
    expect(assignedCount(3)).toBe('3 roles assigned.');
  });
});

describe('roleUnavailable', () => {
  const plain = { name: 'reader', client_key: null, admin_reach: [] as never[] };

  it('leaves a role that reaches no capability', () => {
    expect(roleUnavailable(plain, [])).toBeNull();
  });

  it('keeps an admin capability to the account itself', () => {
    expect(
      roleUnavailable({ name: 'view-users', client_key: 'odudu-admin', admin_reach: [] }, [
        'view-users',
      ]),
    ).toMatch(/admin capability/u);
  });

  it('keeps a role reaching a capability the caller lacks, naming it (ADR 0040)', () => {
    const nested = { ...plain, admin_reach: ['manage-users' as const, 'view-users' as const] };
    expect(roleUnavailable(nested, ['view-users'])).toBe(
      'reaches manage-users, which you do not hold',
    );
    expect(roleUnavailable(nested, ['manage-users', 'view-users'])).toBeNull();
  });
});

describe('assignedRoles', () => {
  it('lists them by name, a tenant role before a client role of the same name', () => {
    const known = nameIndex([CLIENT, TENANT, { id: 'z', name: 'admin', client_key: null }]);
    expect(assignedRoles(['c1', 't1', 'z'], known)).toEqual([
      { id: 'z', name: 'admin', client: null },
      { id: 't1', name: 'reader', client: null },
      { id: 'c1', name: 'reader', client: 'billing' },
    ]);
  });

  it('names a role it has not seen by its id', () => {
    expect(assignedRoles(['gone'], nameIndex())).toEqual([
      { id: 'gone', name: 'gone', client: null },
    ]);
  });
});
