import { describe, expect, it } from 'vitest';
import {
  disableAsk,
  disableConsequence,
  disableFixed,
  disablesTenant,
} from '#/entities/tenant/services/tenantEnabled';

it('says why the system tenant cannot be switched off, and nothing for another', () => {
  expect(disableFixed('system')).toMatch(/^system cannot be disabled/u);
  expect(disableFixed('acme')).toBeNull();
});

it('says who is locked out, and that only a system administrator can undo it', () => {
  const text = disableConsequence('acme', false);
  expect(text).toMatch(/^Nobody can sign in to acme while it is disabled/u);
  expect(text).toMatch(/Only a system administrator can enable it again/u);
});

it('tells only an operator signed in to that tenant that their own session ends', () => {
  expect(disableConsequence('acme', true)).toMatch(/Your own console session in acme ends/u);
  expect(disableConsequence('acme', false)).not.toMatch(/Your own/u);
});

describe('disablesTenant', () => {
  it('is true only when an enabled tenant is being switched off', () => {
    expect(disablesTenant(true, false)).toBe(true);
    expect(disablesTenant(false, false)).toBe(false);
    expect(disablesTenant(true, true)).toBe(false);
    expect(disablesTenant(false, true)).toBe(false);
  });
});

describe('disablesTenant from raw values', () => {
  it('reads a value that is not a boolean as not enabled', () => {
    expect(disablesTenant(undefined, false)).toBe(false);
    expect(disablesTenant('true', false)).toBe(false);
    expect(disablesTenant(true, undefined)).toBe(true);
  });
});

describe('disableAsk', () => {
  it('asks only for the save that switches an enabled tenant off', () => {
    expect(disableAsk(true, false)).toBe(true);
    expect(disableAsk(true, true)).toBeNull();
    expect(disableAsk(false, true)).toBeNull();
  });
});
