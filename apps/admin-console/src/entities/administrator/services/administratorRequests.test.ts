import { describe, expect, it } from 'vitest';
import {
  administratorCalls,
  administratorNeeds,
  GRANT_NEEDS,
  subjectlessRequest,
} from '#/entities/administrator/services/administratorRequests';
import { tenantAdminCarries } from '#/shared/services/capabilities';

describe('the first administrator', () => {
  it('makes only the calls not yet made, the password last', () => {
    expect(administratorCalls({ subjectId: null, granted: false })).toEqual([
      'create',
      'grant',
      'password',
    ]);
    expect(administratorCalls({ subjectId: 's1', granted: false })).toEqual(['grant', 'password']);
    expect(administratorCalls({ subjectId: 's1', granted: true })).toEqual(['password']);
  });
});

describe('what adding an administrator needs', () => {
  it('is what each call still to make needs, and for the grant all that tenant-admin carries', () => {
    const fresh = administratorNeeds('acme', { subjectId: null, granted: false });
    expect(fresh.slice(0, 3)).toEqual(['manage-users', 'manage-clients', 'view-users']);
    expect([...fresh].sort()).toEqual([...tenantAdminCarries('acme')].sort());
    expect(administratorNeeds('system', { subjectId: 's1', granted: false })).toContain(
      'manage-tenants',
    );
    // The password is issued to a subject already holding tenant-admin, and
    // a write to a subject is held to what the subject holds (ADR 0040).
    const resumed = administratorNeeds('acme', { subjectId: 's1', granted: true });
    expect(resumed[0]).toBe('manage-users');
    expect([...resumed].sort()).toEqual([...tenantAdminCarries('acme')].sort());
  });

  it('asks only the capabilities chosen, beside what the calls need, when Full is not', () => {
    const chosen = administratorNeeds('acme', {
      subjectId: null,
      granted: false,
      holdings: ['view-audit'],
    });
    expect([...chosen].sort()).toEqual(
      ['manage-clients', 'manage-users', 'view-audit', 'view-users'].sort(),
    );
  });
});

describe('what changing what an administrator holds needs', () => {
  it('is each distinct capability the grant requests make', () => {
    expect([...GRANT_NEEDS].sort()).toEqual(['manage-clients', 'manage-users', 'view-users']);
  });
});

describe('a call that ran with no subject', () => {
  it('is reported against the request it would have made', () => {
    expect(subjectlessRequest('grant')).toBe('set-roles');
    expect(subjectlessRequest('password')).toBe('password');
  });
});
