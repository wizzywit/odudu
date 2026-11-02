import { describe, expect, it } from 'vitest';
import {
  accountIdleNote,
  assignedCount,
  assignedRoles,
  heldCapabilitiesText,
  roleUnavailable,
  serviceAccess,
  serviceRolesRecord,
  serviceRolesRecordOf,
  splitAssigned,
} from '#/features/clients/services/account';
import { knownAssignments } from '#/shared/services/mappedRoles';

const ADMIN = { id: 'a1', name: 'manage-users', client_id: 'ac', client_key: 'odudu-admin' };
const TENANT = { id: 't1', name: 'reader', client_id: null, client_key: null };
const CLIENT = { id: 'c1', name: 'reader', client_id: 'cc', client_key: 'billing' };

describe('serviceRolesRecordOf', () => {
  it('is the account record of a client that has one, and nothing for one that has none', () => {
    expect(serviceRolesRecordOf({ service_subject_id: 's1' })).toBe('subjects/s1/roles');
    expect(serviceRolesRecordOf({ service_subject_id: null })).toBeNull();
    expect(serviceRolesRecordOf(undefined)).toBeNull();
  });
});

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
    const known = knownAssignments([CLIENT, TENANT, { id: 'z', name: 'admin', client_key: null }]);
    expect(assignedRoles(['c1', 't1', 'z'], known)).toEqual([
      { id: 'z', name: 'admin', client: null },
      { id: 't1', name: 'reader', client: null },
      { id: 'c1', name: 'reader', client: 'billing' },
    ]);
  });

  it('names a role it has not seen by its id', () => {
    expect(assignedRoles(['gone'], knownAssignments())).toEqual([
      { id: 'gone', name: 'gone', client: null },
    ]);
  });
});

describe('accountIdleNote', () => {
  it('says an account is idle while the client credentials grant is off, and keeps its roles', () => {
    expect(accountIdleNote({ service_subject_id: 's1', grant_types: ['authorization_code'] })).toBe(
      'Not in use: the client credentials grant is off. The account keeps its roles.',
    );
  });

  it('says nothing while the grant is on, or when there is no account', () => {
    expect(
      accountIdleNote({ service_subject_id: 's1', grant_types: ['client_credentials'] }),
    ).toBeNull();
    expect(accountIdleNote({ service_subject_id: null, grant_types: [] })).toBeNull();
  });
});

describe('serviceAccess', () => {
  const held = (capabilities: readonly ('manage-users' | 'view-users')[]) => ({
    capabilities,
    crossTenant: false,
  });

  const NONE = { service_subject_id: null, type: 'confidential', builtin_admin: false } as const;

  it('says a client with no account has none, whoever asks', () => {
    expect(serviceAccess(NONE, held(['manage-users']))).toMatchObject({ status: 'none' });
    expect(serviceAccess(NONE, undefined)).toMatchObject({ status: 'none' });
  });

  it('words the absence by what the client is, not by its type alone', () => {
    const note = (client: Parameters<typeof serviceAccess>[0]) => {
      const access = serviceAccess(client, undefined);
      return access.status === 'none' ? access.note : null;
    };
    expect(note({ ...NONE, type: 'public' })).toBe('A public client has no service account.');
    expect(note(NONE)).toBe('This client has no service account.');
    expect(note({ ...NONE, builtin_admin: true })).toBe(
      "No service account. This client signs people in; it doesn't sign in as itself.",
    );
    expect(note({ ...NONE, type: 'public', builtin_admin: true })).toBe(
      "No service account. This client signs people in; it doesn't sign in as itself.",
    );
  });

  it('holds the roles from a caller without manage-users, and names the account for one with it', () => {
    expect(serviceAccess({ ...NONE, service_subject_id: 's1' }, held(['view-users']))).toEqual({
      status: 'denied',
    });
    expect(serviceAccess({ ...NONE, service_subject_id: 's1' }, held(['manage-users']))).toEqual({
      status: 'ready',
      subjectId: 's1',
    });
  });

  it('rules nobody out before whoami has answered', () => {
    expect(serviceAccess({ ...NONE, service_subject_id: 's1' }, undefined)).toEqual({
      status: 'ready',
      subjectId: 's1',
    });
  });
});
