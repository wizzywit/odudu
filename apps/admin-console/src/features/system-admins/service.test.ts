import { describe, expect, it } from 'vitest';
import {
  administratorsAccess,
  choosable,
  grantedText,
  grantFailureText,
  pickerUnavailable,
  subjectName,
  type Subject,
} from '#/features/system-admins/service.ts';
import { tenantAdminCarries } from '#/shared/service/administrators.ts';
import type { AdminCapability, Authority } from '#/shared/service/principal.ts';

const caller = (...capabilities: AdminCapability[]): Authority => ({
  capabilities,
  crossTenant: false,
});
const subject = (id: string): Subject => ({ id, username: id }) as Subject;

describe('a subject of system', () => {
  it('is named by username, or by id when it has none', () => {
    expect(subjectName({ id: 's1', username: 'ada' })).toBe('ada');
    expect(subjectName({ id: 's2', username: null })).toBe('s2');
  });
});

describe('what the system administrators page needs', () => {
  it('asks nothing until whoami has answered', () => {
    expect(administratorsAccess(undefined)).toEqual({
      createNeeds: [],
      changeNeeds: [],
      blocked: null,
    });
  });

  it('is met by Full in system', () => {
    expect(administratorsAccess(caller(...tenantAdminCarries('system')))).toEqual({
      createNeeds: [],
      changeNeeds: [],
      blocked: null,
    });
  });

  it('names what creating and changing need, and says which changes are ruled out', () => {
    const access = administratorsAccess(caller('manage-tenants'));
    expect(access.createNeeds).toContain('manage-users');
    expect(access.changeNeeds).toEqual(['manage-users']);
    expect(access.blocked?.change).toBe('create them or change what they hold');
    expect(access.blocked?.needs).toContain('manage-clients');
  });
});

describe('the picker of subjects', () => {
  const holders = new Set(['s1']);

  it('marks a subject that already holds a capability, once the holders are known', () => {
    expect(pickerUnavailable(holders, subject('s1'))).toBe(
      'already holds a capability: change it in the list',
    );
    expect(pickerUnavailable(holders, subject('s2'))).toBeNull();
    expect(pickerUnavailable(null, subject('s1'))).toBeNull();
  });

  it('chooses an offered subject that does not already hold one', () => {
    const options = [subject('s1'), subject('s2')];
    expect(choosable('s2', holders, options)).toBe(options[1]);
    expect(choosable('s1', holders, options)).toBeNull();
    expect(choosable('s1', null, options)).toBe(options[0]);
    expect(choosable('s9', holders, options)).toBeNull();
    expect(choosable(null, holders, options)).toBeNull();
  });
});

describe('a grant', () => {
  const problem = (status: number, extra: object = {}) =>
    ({
      failure: {
        ok: false,
        kind: 'problem',
        problem: { type: 'about:blank', title: 'Title', status, ...extra },
      },
      request: 'set-roles',
    }) as const;

  it('says what it gave, by label', () => {
    expect(grantedText('ada', ['tenant-admin'])).toBe(
      'ada now holds Full (tenant-admin) in system.',
    );
    expect(grantedText('ada', ['view-audit', 'manage-users'])).toBe(
      'ada now holds view-audit, manage-users in system.',
    );
  });

  it('words each way it fails', () => {
    expect(
      grantFailureText('ada', { failure: { ok: false, kind: 'network' }, request: 'roles' }),
    ).toBe('Could not confirm whether ada was given it. Check the list before trying again.');
    expect(
      grantFailureText('ada', { failure: { ok: false, kind: 'schema' }, request: 'roles' }),
    ).toBe('ada may have been given it, but the answer could not be read. Check the list.');
    expect(
      grantFailureText('ada', { failure: { ok: false, kind: 'defect' }, request: 'roles' }),
    ).toBe(
      'The console could not finish, so ada was not given it. This is a fault in the console, not something you did.',
    );
    expect(grantFailureText('ada', problem(403))).toBe(
      'ada was not given it: it needs the manage-users capability.',
    );
    expect(grantFailureText('ada', problem(403, { detail: 'the caller does not hold: x' }))).toBe(
      'ada was not given it: the caller does not hold: x.',
    );
    expect(grantFailureText('ada', problem(412))).toBe(
      'ada was not given it: their roles changed while this ran. Try again.',
    );
    expect(grantFailureText('ada', problem(409, { detail: 'last administrator' }))).toBe(
      'ada was not given it: last administrator.',
    );
    expect(grantFailureText('ada', problem(500))).toBe('ada was not given it: Title.');
  });
});
