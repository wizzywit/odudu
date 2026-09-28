import { isTenantName, TENANT_NAME_RULE as CONTRACT_RULE } from '@odudu/contracts';
import { describe, expect, it } from 'vitest';
import {
  isReservedTenantName,
  isValidTenantName,
  RESERVED_TENANT_NAMES,
  TENANT_NAME_RULE,
} from '#/service/tenant-name';

// Shared with tenant-name-check.int.test.ts, which proves the CHECK the
// migration adds refuses exactly what this predicate refuses.
export const CORPUS = {
  accepted: ['a', 'acme', 'a1', 'a-b', 'x'.repeat(63)],
  refused: ['', '-a', 'a-', 'A', 'a_b', 'a/b', 'a.b', 'a b', 'x'.repeat(64), 'ä'],
};

describe('isValidTenantName', () => {
  it.each(CORPUS.accepted)('accepts %j', (name) => {
    expect(isValidTenantName(name)).toBe(true);
  });

  it.each(CORPUS.refused)('refuses %j', (name) => {
    expect(isValidTenantName(name)).toBe(false);
  });

  // The console validates with the contract's copy before any request, so
  // the predicate the CHECK is held to must be that same one.
  it('is the rule @odudu/contracts states, not a copy of it', () => {
    expect(isValidTenantName).toBe(isTenantName);
    expect(TENANT_NAME_RULE).toBe(CONTRACT_RULE);
  });

  it('states the rule every refusal answers with', () => {
    expect(TENANT_NAME_RULE.length).toBeGreaterThan(0);
  });
});

describe('isReservedTenantName', () => {
  it('reserves system and count', () => {
    expect(RESERVED_TENANT_NAMES).toEqual(['system', 'count']);
    expect(isReservedTenantName('system')).toBe(true);
    expect(isReservedTenantName('count')).toBe(true);
  });

  it('leaves an ordinary name unreserved', () => {
    expect(isReservedTenantName('acme')).toBe(false);
  });
});
