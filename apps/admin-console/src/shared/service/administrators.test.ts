import { describe, expect, it } from 'vitest';
import {
  administratorCalls,
  administratorCapability,
  administratorNeeds,
  builtinAdminClient,
  GRANT_NEEDS,
  HOLDINGS_REQUIRED,
  holdingsProblem,
  tenantAdminCarries,
  tenantAdminRole,
  withRole,
} from '#/shared/service/administrators.ts';

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

describe('the tenant-admin role', () => {
  it('is the role named tenant-admin on the built-in odudu-admin client, and no other', () => {
    const clients = [
      { id: 'c-own', client_id: 'odudu-admin-copy', builtin_admin: false },
      { id: 'c-builtin', client_id: 'odudu-admin', builtin_admin: true },
    ];
    expect(builtinAdminClient(clients)).toBe('c-builtin');
    expect(builtinAdminClient(clients.slice(0, 1))).toBeNull();
    const roles = [
      { id: 'r-other', name: 'tenant-admin-x', client_id: 'c-builtin' },
      { id: 'r-own', name: 'tenant-admin', client_id: 'c-own' },
      { id: 'r-admin', name: 'tenant-admin', client_id: 'c-builtin' },
    ];
    expect(tenantAdminRole(roles, 'c-builtin')).toBe('r-admin');
    expect(tenantAdminRole(roles.slice(0, 2), 'c-builtin')).toBeNull();
  });

  it('is added to the roles a subject already holds, once', () => {
    expect(withRole(['r1'], 'r-admin')).toEqual(['r1', 'r-admin']);
    expect(withRole(['r-admin', 'r1'], 'r-admin')).toEqual(['r-admin', 'r1']);
  });

  it('carries every capability of the tenant, and in system manage-tenants as well', () => {
    expect(tenantAdminCarries('acme')).not.toContain('manage-tenants');
    expect(tenantAdminCarries('acme')).toContain('manage-keys');
    expect(tenantAdminCarries('system')).toContain('manage-tenants');
  });
});

describe('what the guard counts', () => {
  it('is manage-tenants in system and tenant-admin anywhere else', () => {
    expect(administratorCapability('system')).toBe('manage-tenants');
    expect(administratorCapability('acme')).toBe('tenant-admin');
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

describe('the holdings an administrator is given', () => {
  it('must name Full or at least one capability', () => {
    expect(holdingsProblem([])).toBe(HOLDINGS_REQUIRED);
    expect(HOLDINGS_REQUIRED).toBe('Choose Full, or at least one capability.');
    expect(holdingsProblem(['tenant-admin'])).toBeNull();
    expect(holdingsProblem(['view-audit'])).toBeNull();
  });
});

describe('what changing what an administrator holds needs', () => {
  it('is each distinct capability the grant requests make', () => {
    expect([...GRANT_NEEDS].sort()).toEqual(['manage-clients', 'manage-users', 'view-users']);
  });
});
