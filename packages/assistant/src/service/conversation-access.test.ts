import { describe, expect, it } from 'vitest';
import {
  actsInTenantOf,
  conversationIsCallers,
  crossTenant,
  settingsOfTwo,
} from '#/service/conversation-access';

const HOME = 'home-tenant';
const X = 'tenant-x';
const Y = 'tenant-y';

const caller = (target?: { id: string; name: string }) => ({
  tenantId: HOME,
  ownerSubjectId: 'sub-1',
  ...(target === undefined ? {} : { target }),
});
const record = (targetTenantId: string | null, owner = 'sub-1') => ({
  tenantId: HOME,
  ownerSubjectId: owner,
  targetTenantId,
});

describe('which tenant a call acts in', () => {
  it('is the home tenant when the caller names no target', () => {
    expect(actsInTenantOf(caller())).toBe(HOME);
    expect(crossTenant(caller())).toBe(false);
  });

  it('is the target when it differs from home', () => {
    expect(actsInTenantOf(caller({ id: X, name: 'x' }))).toBe(X);
    expect(crossTenant(caller({ id: X, name: 'x' }))).toBe(true);
  });

  it('treats a target equal to home as the home case', () => {
    expect(crossTenant(caller({ id: HOME, name: 'home' }))).toBe(false);
  });
});

describe('whether a conversation is the caller', () => {
  it('is theirs in the home tenant when both name no target', () => {
    expect(conversationIsCallers(record(null), caller())).toBe(true);
  });

  it('is not another owner', () => {
    expect(conversationIsCallers(record(null, 'sub-2'), caller())).toBe(false);
  });

  it('is theirs only at the tenant it was created for', () => {
    expect(conversationIsCallers(record(X), caller({ id: X, name: 'x' }))).toBe(true);
    expect(conversationIsCallers(record(X), caller({ id: Y, name: 'y' }))).toBe(false);
  });

  it('is never served at the home path once bound to a target, nor the reverse', () => {
    expect(conversationIsCallers(record(X), caller())).toBe(false);
    expect(conversationIsCallers(record(null), caller({ id: X, name: 'x' }))).toBe(false);
  });
});

describe('the stricter of two tenants settings', () => {
  const base = { enabled: true, maskEmails: false, modes: ['ask', 'act'] as const };

  it('masks when either tenant masks', () => {
    expect(settingsOfTwo(base, { ...base, maskEmails: true }).maskEmails).toBe(true);
    expect(settingsOfTwo({ ...base, maskEmails: true }, base).maskEmails).toBe(true);
    expect(settingsOfTwo(base, base).maskEmails).toBe(false);
  });

  it('is off when either tenant has the assistant off', () => {
    expect(settingsOfTwo(base, { ...base, enabled: false }).enabled).toBe(false);
    expect(settingsOfTwo({ ...base, enabled: false }, base).enabled).toBe(false);
  });

  it('offers a mode only where both tenants do', () => {
    expect(settingsOfTwo(base, { ...base, modes: ['ask'] }).modes).toEqual(['ask']);
    expect(settingsOfTwo({ ...base, modes: ['ask'] }, base).modes).toEqual(['ask']);
    expect(settingsOfTwo(base, base).modes).toEqual(['ask', 'act']);
  });
});
