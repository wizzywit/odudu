import { describe, expect, it } from 'vitest';
import {
  accountIdleNote,
  serviceAccess,
  serviceRolesRecord,
  serviceRolesRecordOf,
} from '#/pages/clients/services/serviceAccess';

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
});

describe('accountIdleNote', () => {
  it('says an account is idle while the client credentials grant is off, and how it goes', () => {
    expect(accountIdleNote({ service_subject_id: 's1', grant_types: ['authorization_code'] })).toBe(
      'Not in use: the client credentials grant is off. The account keeps its roles until the grant is turned on and off again, which removes it.',
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

  const NONE: Parameters<typeof serviceAccess>[0] = {
    service_subject_id: null,
    type: 'confidential',
    builtin_admin: false,
    grant_types: ['client_credentials'],
  };

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
    expect(note({ ...NONE, grant_types: ['authorization_code'] })).toBe(
      'No service account: the client credentials grant is off. Turning it on creates one.',
    );
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
