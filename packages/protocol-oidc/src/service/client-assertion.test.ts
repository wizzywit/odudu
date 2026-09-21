import { describe, expect, it } from 'vitest';
import {
  CLIENT_ASSERTION_TYPE,
  MAX_ASSERTION_LIFETIME_SECONDS,
  parseClientAssertion,
  type ClientAssertionBody,
  type ExpectedClientAssertion,
} from '#/service/client-assertion';

const AUDIENCE = 'https://issuer.example/token';
const now = new Date('2026-01-01T00:00:00.000Z');
const nowSeconds = Math.floor(now.getTime() / 1000);
const expected: ExpectedClientAssertion = { audience: AUDIENCE };

const validClaims = {
  iss: 'client-a',
  sub: 'client-a',
  aud: AUDIENCE,
  exp: nowSeconds + 60,
  jti: 'assertion-1',
};

const expiredClaims = { ...validClaims, exp: nowSeconds - 1 };
const farFuture = nowSeconds + MAX_ASSERTION_LIFETIME_SECONDS + 1;

function encodeSegment(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

// An unsigned-but-well-formed three-segment JWT. The signature segment is
// never read by `parseClientAssertion` — verifying it needs the client's
// key, which this function is never handed — so any non-empty value here
// stands in for one.
function jwt(claims: Record<string, unknown>): string {
  return `${encodeSegment({ alg: 'RS256', typ: 'JWT' })}.${encodeSegment(claims)}.signature`;
}

function body(claims: Record<string, unknown>): ClientAssertionBody {
  return { client_assertion: jwt(claims), client_assertion_type: CLIENT_ASSERTION_TYPE };
}

describe('parseClientAssertion', () => {
  it('accepts a well-formed assertion and reports the client it claims to be', () => {
    expect(parseClientAssertion(body(validClaims), now, expected)).toEqual({
      kind: 'ok',
      claimedClientId: 'client-a',
      jti: validClaims.jti,
      expiresAt: new Date(validClaims.exp * 1000),
    });
  });

  it('refuses an assertion type it does not define', () => {
    expect(
      parseClientAssertion(
        { ...body(validClaims), client_assertion_type: 'urn:other' },
        now,
        expected,
      ).kind,
    ).toBe('unsupported');
  });

  it('refuses an assertion whose iss and sub disagree', () => {
    expect(
      parseClientAssertion(body({ ...validClaims, sub: 'client-b' }), now, expected).kind,
    ).toBe('invalid');
  });

  it('refuses one whose aud is not this token endpoint', () => {
    expect(
      parseClientAssertion(body({ ...validClaims, aud: 'https://elsewhere' }), now, expected).kind,
    ).toBe('invalid');
  });

  it('refuses one that has expired', () => {
    expect(parseClientAssertion(body(expiredClaims), now, expected).kind).toBe('invalid');
  });

  it('refuses one with no jti, since replay cannot be detected without it', () => {
    const { jti, ...withoutJti } = validClaims;
    expect(jti).toBeDefined();
    expect(parseClientAssertion(body(withoutJti), now, expected).kind).toBe('invalid');
  });

  it('refuses one whose exp is further out than the ceiling', () => {
    expect(parseClientAssertion(body({ ...validClaims, exp: farFuture }), now, expected).kind).toBe(
      'invalid',
    );
  });

  // RFC 7523 §3's claims arrive as JSON from an untrusted party. A type
  // mismatch is refused outright rather than coerced into the shape this
  // expects — the four plausible confusions a JWT library's own laxity
  // could otherwise paper over.
  it('refuses a sub carried as a number rather than a string', () => {
    expect(parseClientAssertion(body({ ...validClaims, sub: 0 }), now, expected).kind).toBe(
      'invalid',
    );
  });

  it('refuses an aud carried as an array rather than a string', () => {
    expect(
      parseClientAssertion(body({ ...validClaims, aud: [AUDIENCE] }), now, expected).kind,
    ).toBe('invalid');
  });

  it('refuses an exp carried as a numeric string rather than a number', () => {
    expect(
      parseClientAssertion(body({ ...validClaims, exp: String(validClaims.exp) }), now, expected)
        .kind,
    ).toBe('invalid');
  });

  it('refuses a client_assertion that is not a three-segment JWT', () => {
    expect(
      parseClientAssertion(
        { client_assertion: 'not-a-jwt', client_assertion_type: CLIENT_ASSERTION_TYPE },
        now,
        expected,
      ).kind,
    ).toBe('invalid');
  });

  it('refuses a client_assertion with more than three dot-separated segments', () => {
    expect(
      parseClientAssertion(
        {
          client_assertion: `${jwt(validClaims)}.extra`,
          client_assertion_type: CLIENT_ASSERTION_TYPE,
        },
        now,
        expected,
      ).kind,
    ).toBe('invalid');
  });

  it('refuses a client_assertion that is missing entirely', () => {
    expect(
      parseClientAssertion({ client_assertion_type: CLIENT_ASSERTION_TYPE }, now, expected).kind,
    ).toBe('invalid');
  });
});
