import { describe, expect, it } from 'vitest';
import {
  bindToTenant,
  randomSecret,
  sameSecret,
  sha256,
  splitTenantBound,
} from '#/service/secrets';

const TENANT = '0199aa00-0000-7000-8000-000000000001';

describe('tenant-bound values', () => {
  it('round-trips a tenant id and its secret', () => {
    const secret = randomSecret();
    expect(splitTenantBound(bindToTenant(TENANT, secret))).toEqual({ tenantId: TENANT, secret });
  });

  it.each([
    ['no separator', 'abc'],
    ['a tenant that is not a UUID', 'acme.c2VjcmV0'],
    ['an empty secret', `${TENANT}.`],
    ['a secret outside base64url', `${TENANT}.a b`],
    ['a second separator', `${TENANT}.a.b`],
  ])('refuses %s', (_label, value) => {
    expect(splitTenantBound(value)).toBeNull();
  });
});

describe('secrets', () => {
  it('draws 32 random bytes as base64url', () => {
    const value = randomSecret();
    expect(Buffer.from(value, 'base64url')).toHaveLength(32);
    expect(randomSecret()).not.toBe(value);
  });

  it('hashes to the 32 bytes the hash columns hold', () => {
    expect(sha256('abc').toString('hex')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('compares two values without regard to their lengths', () => {
    expect(sameSecret('abc', 'abc')).toBe(true);
    expect(sameSecret('abc', 'abd')).toBe(false);
    expect(sameSecret('abc', 'abcd')).toBe(false);
  });
});
