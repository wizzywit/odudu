import { describe, expect, it } from 'vitest';
import { CHOOSE_TENANT, SWITCH_HREF, type Principal } from '#/features/session/service/address.ts';
import {
  entersDirectly,
  homeTarget,
  isSystemPrincipal,
  replacedSession,
  signInHome,
  tenantEntry,
} from '#/features/session/service/entry.ts';

const grace: Principal = { tenant: 'acme', subjectId: 's1', username: 'grace' };

const root: Principal = { tenant: 'system', subjectId: 's9', username: 'root' };

describe('who a sign-in page treats as a system administrator', () => {
  it('is a principal issued by the system tenant', () => {
    expect(isSystemPrincipal(root)).toBe(true);
    expect(isSystemPrincipal(grace)).toBe(false);
    expect(isSystemPrincipal(null)).toBe(false);
  });

  it('replaces only a tenant administrator session', () => {
    expect(replacedSession(grace)).toBe(grace);
    expect(replacedSession(root)).toBeNull();
    expect(replacedSession(null)).toBeNull();
  });

  it('enters a tenant directly when signed in as its administrator or from the system tenant', () => {
    expect(entersDirectly(grace, 'acme')).toBe(true);
    expect(entersDirectly(grace, 'other')).toBe(false);
    expect(entersDirectly(root, 'other')).toBe(true);
    expect(entersDirectly(null, 'acme')).toBe(false);
  });
});

describe('where the bare console sends the visitor', () => {
  it('asks first when an administrator of another tenant names one', () => {
    expect(homeTarget({ principal: grace, named: 'other', choosing: false })).toEqual({
      kind: 'elsewhere',
      principal: grace,
      tenant: 'other',
    });
  });

  it('goes to the tenant named, signed in or not', () => {
    expect(homeTarget({ principal: null, named: 'acme', choosing: false })).toEqual({
      kind: 'leaving',
      tenant: 'acme',
    });
    expect(homeTarget({ principal: root, named: 'other', choosing: true })).toEqual({
      kind: 'leaving',
      tenant: 'other',
    });
  });

  it('goes to the signed-in administrator own tenant unless they chose to switch', () => {
    expect(homeTarget({ principal: grace, named: null, choosing: false })).toEqual({
      kind: 'leaving',
      tenant: 'acme',
    });
    expect(homeTarget({ principal: grace, named: null, choosing: true })).toEqual({
      kind: 'choose',
    });
  });

  it('asks which tenant when nobody is signed in and none is named', () => {
    expect(homeTarget({ principal: null, named: null, choosing: false })).toEqual({
      kind: 'choose',
    });
  });

  it('has the address that asks the question anyway', () => {
    expect(SWITCH_HREF).toBe(`/console/?${CHOOSE_TENANT}`);
  });
});

describe('who may open a tenant page', () => {
  it('sends nobody to sign in where they were issued, else to the tenant in the address', () => {
    expect(signInHome(null, 'acme')).toBe('acme');
    expect(signInHome(root, 'acme')).toBe('system');
    expect(tenantEntry(null, null, 'acme')).toEqual({
      kind: 'signing-in',
      tenant: 'acme',
      ended: false,
    });
    expect(tenantEntry(null, root, 'acme')).toEqual({
      kind: 'signing-in',
      tenant: 'system',
      ended: true,
    });
  });

  it('lets in the tenant own administrator and any system administrator', () => {
    expect(tenantEntry(grace, null, 'acme')).toEqual({ kind: 'allowed', principal: grace });
    expect(tenantEntry(root, null, 'acme')).toEqual({ kind: 'allowed', principal: root });
  });

  it('asks an administrator of another tenant first', () => {
    expect(tenantEntry(grace, null, 'other')).toEqual({ kind: 'elsewhere', principal: grace });
  });
});
