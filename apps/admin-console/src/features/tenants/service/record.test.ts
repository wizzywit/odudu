import { describe, expect, it } from 'vitest';
import { tenantAdminCarries } from '#/shared/service/administrators.ts';
import type { AdminCapability, Authority } from '#/shared/service/principal.ts';
import {
  disableFixed,
  tenantChangeFailure,
  tenantRecord,
  tenantRecordAccess,
  TENANT_TABS,
} from '#/features/tenants/service/record.ts';

describe('the tenant record page', () => {
  const caller = (...capabilities: AdminCapability[]): Authority => ({
    capabilities,
    crossTenant: true,
  });

  it('keeps its tabs and its record name in one place', () => {
    expect(TENANT_TABS).toEqual(['general', 'administrators', 'export']);
    expect(tenantRecord('acme')).toBe('tenants/acme');
  });

  it('asks nothing until whoami has answered', () => {
    expect(tenantRecordAccess(undefined, 'acme')).toEqual({
      readNeeds: [],
      addNeeds: [],
      blocked: null,
    });
  });

  it('names what reading the record and adding an administrator need and the caller lacks', () => {
    const access = tenantRecordAccess(caller('manage-tenants'), 'acme');
    expect(access.readNeeds).toEqual(['manage-tenant']);
    expect(access.addNeeds).toContain('manage-users');
    expect(access.blocked?.change).toBe('add their administrators');
    const full = tenantRecordAccess(caller(...tenantAdminCarries('acme')), 'acme');
    expect(full).toEqual({ readNeeds: [], addNeeds: [], blocked: null });
  });
});

describe('enabling and disabling a tenant', () => {
  it('fixes system as enabled, and says why', () => {
    expect(disableFixed('system')).toMatch(/^system cannot be disabled/);
    expect(disableFixed('acme')).toBeNull();
  });

  it('words each way the change fails', () => {
    const problem = (status: number, extra: object = {}) =>
      ({
        ok: false,
        kind: 'problem',
        problem: { type: 'about:blank', title: 'Title', status, ...extra },
      }) as const;
    expect(tenantChangeFailure('acme', { ok: false, kind: 'network' })).toBe(
      'Could not confirm the change to acme. It has not been sent again; check its status before trying again.',
    );
    expect(tenantChangeFailure('acme', problem(412))).toBe(
      'acme changed elsewhere since you opened it. It has been read again; look at it before trying again.',
    );
    expect(tenantChangeFailure('acme', problem(403))).toBe(
      'This needs the manage-tenant capability.',
    );
    expect(tenantChangeFailure('acme', problem(409, { detail: 'detail' }))).toBe('detail');
    expect(tenantChangeFailure('acme', problem(409))).toBe('Title');
    for (const kind of ['schema', 'defect'] as const) {
      expect(tenantChangeFailure('acme', { ok: false, kind })).toBe(
        'The console could not make the change. This is a fault in the console, not something you did.',
      );
    }
  });
});
