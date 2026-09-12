import { describe, expect, it } from 'vitest';
import { extractBearerToken, presentedBearerToken } from '#/service/bearer-token';

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

describe('presentedBearerToken across the header and the form-encoded body', () => {
  it('reads the header when no body was sent', () => {
    expect(presentedBearerToken('Bearer abc', undefined)).toEqual({
      kind: 'present',
      token: 'abc',
    });
  });

  it('reads access_token from the body when no header was sent', () => {
    expect(presentedBearerToken(undefined, { access_token: 'abc' })).toEqual({
      kind: 'present',
      token: 'abc',
    });
  });

  it('calls a request presenting the token both ways ambiguous', () => {
    expect(presentedBearerToken('Bearer abc', { access_token: 'abc' })).toEqual({
      kind: 'ambiguous',
    });
  });

  it('calls a repeated access_token ambiguous even with no header', () => {
    expect(presentedBearerToken(undefined, { access_token: ['abc', 'def'] })).toEqual({
      kind: 'ambiguous',
    });
  });

  // A body parser that can produce numbers or objects must not smuggle one
  // into a rule written for strings.
  it.each([[42], [{ nested: true }], [null], [['a']]])(
    'treats a non-string access_token as no credential (%j)',
    (value) => {
      expect(presentedBearerToken(undefined, { access_token: value }).kind).not.toBe('present');
    },
  );

  it('treats an empty access_token as absent rather than as a credential', () => {
    expect(presentedBearerToken(undefined, { access_token: '' })).toEqual({ kind: 'absent' });
  });

  // A parser is free to hand back an object with a prototype; anything
  // reached through it was never sent by the client.
  it('does not read an inherited access_token as a presented credential', () => {
    const body: unknown = Object.create({ access_token: 'inherited' });
    expect(presentedBearerToken(undefined, body)).toEqual({ kind: 'absent' });
  });

  it('is unmoved by a body that is not a parameter bag', () => {
    expect(presentedBearerToken('Bearer abc', 'access_token=abc')).toEqual({
      kind: 'present',
      token: 'abc',
    });
  });
});
