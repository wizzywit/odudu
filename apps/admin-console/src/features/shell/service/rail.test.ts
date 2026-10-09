import { describe, expect, it } from 'vitest';
import {
  actsWithSystemAuthority,
  showsSystemArea,
  systemRecordHref,
} from '#/features/shell/service/rail.ts';

const SYSTEM_ADMIN = { tenant: 'system', subjectId: 's0', username: 'root' };

const ACME_ADMIN = { tenant: 'acme', subjectId: 's1', username: 'grace' };

const everything = {
  capabilities: ['manage-tenants', 'view-users'] as const,
  crossTenant: false,
};

describe('the System area', () => {
  it('is shown to a system administrator signed in to system', () => {
    expect(showsSystemArea(SYSTEM_ADMIN, 'system', { ...everything })).toBe(true);
  });

  it('is not shown inside another tenant, to a tenant administrator, or without manage-tenants', () => {
    expect(showsSystemArea(SYSTEM_ADMIN, 'acme', everything)).toBe(false);
    expect(showsSystemArea(ACME_ADMIN, 'system', everything)).toBe(false);
    expect(
      showsSystemArea(SYSTEM_ADMIN, 'system', { capabilities: ['view-users'], crossTenant: false }),
    ).toBe(false);
    expect(showsSystemArea(SYSTEM_ADMIN, 'system', undefined)).toBe(false);
  });
});

describe('the system-authority context bar', () => {
  it('shows for a system administrator inside another tenant', () => {
    expect(
      actsWithSystemAuthority(SYSTEM_ADMIN, 'acme', { capabilities: [], crossTenant: true }),
    ).toBe(true);
    expect(actsWithSystemAuthority(SYSTEM_ADMIN, 'acme', undefined)).toBe(true);
  });

  it('does not show in system itself, for a tenant administrator, or once whoami says otherwise', () => {
    expect(actsWithSystemAuthority(SYSTEM_ADMIN, 'system', undefined)).toBe(false);
    expect(actsWithSystemAuthority(ACME_ADMIN, 'acme', undefined)).toBe(false);
    expect(
      actsWithSystemAuthority(SYSTEM_ADMIN, 'acme', { capabilities: [], crossTenant: false }),
    ).toBe(false);
  });
});

describe('the way back to system', () => {
  it('is the tenant’s record under System › Tenants, where it was entered', () => {
    expect(systemRecordHref('acme')).toBe('/console/system/tenants/acme');
    expect(systemRecordHref('a b')).toBe('/console/system/tenants/a%20b');
  });
});
