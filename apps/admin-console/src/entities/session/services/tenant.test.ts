import { describe, expect, it } from 'vitest';
import { isTenantName } from '#/shared/lib/services/principal';
import { type Principal } from '#/entities/session/types/principal';
import {
  namedTenant,
  remembers,
  tenantMissing,
  tenantProblem,
} from '#/entities/session/services/tenant';
import { TENANT_NAME_RULE_TEXT } from '#/shared/lib/services/principal';

const grace: Principal = { tenant: 'acme', subjectId: 's1', username: 'grace' };

const root: Principal = { tenant: 'system', subjectId: 's9', username: 'root' };

describe('a tenant name', () => {
  it.each(['acme', 'system', 'a', 'eu-west-1', 'x'.repeat(63)])('accepts %j', (name) => {
    expect(isTenantName(name)).toBe(true);
  });

  it.each(['', 'Acme', '-acme', 'acme-', 'ac me', 'ac/me', 'x'.repeat(64), 'ac.me'])(
    'refuses %j',
    (name) => {
      expect(isTenantName(name)).toBe(false);
    },
  );
});

describe('the last tenant, remembered', () => {
  it('is offered only when no tenant is named and nobody is signed in', () => {
    expect(remembers(null, false)).toBe(true);
    expect(remembers('acme', false)).toBe(false);
    expect(remembers(null, true)).toBe(false);
  });
});

describe('a tenant the admin API does not know', () => {
  it('is only said to be missing for a system administrator outside the system tenant', () => {
    expect(tenantMissing(root, 'ghost', true)).toBe(true);
    expect(tenantMissing(root, 'ghost', false)).toBe(false);
    expect(tenantMissing(root, 'ghost', undefined)).toBeUndefined();
  });

  it('is never missing to anybody else, once whoami has answered', () => {
    expect(tenantMissing(grace, 'acme', true)).toBe(false);
    expect(tenantMissing(grace, 'acme', false)).toBe(false);
    expect(tenantMissing(root, 'system', true)).toBe(false);
    expect(tenantMissing(grace, 'acme', undefined)).toBeUndefined();
    expect(tenantMissing(null, 'acme', undefined)).toBeUndefined();
  });
});

describe('the tenant a URL names', () => {
  it('is the one asked for when it is a tenant name, else none', () => {
    expect(namedTenant('acme')).toBe('acme');
    expect(namedTenant('Not A Tenant')).toBeNull();
    expect(namedTenant(null)).toBeNull();
  });

  it('is checked with the words a refused name is answered with', () => {
    expect(tenantProblem('acme')).toBeUndefined();
    expect(tenantProblem('Acme')).toBe(TENANT_NAME_RULE_TEXT);
    expect(tenantProblem('')).toBe(TENANT_NAME_RULE_TEXT);
  });
});
