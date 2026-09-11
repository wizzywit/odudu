import { describe, expect, it } from 'vitest';
import { extractBearerToken } from '#/service/bearer-token';

describe('[RFC6750-2.1-01] the Authorization header bearer token method', () => {
  it('extracts the token from a well-formed Authorization header', () => {
    expect(extractBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('is case-insensitive on the Bearer scheme name', () => {
    expect(extractBearerToken('bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('returns undefined when there is no Authorization header at all', () => {
    expect(extractBearerToken(undefined)).toBeUndefined();
  });

  it('returns undefined for a non-Bearer scheme', () => {
    expect(extractBearerToken('Basic dXNlcjpwYXNz')).toBeUndefined();
  });

  it('returns undefined for an empty Bearer value', () => {
    expect(extractBearerToken('Bearer ')).toBeUndefined();
  });
});
