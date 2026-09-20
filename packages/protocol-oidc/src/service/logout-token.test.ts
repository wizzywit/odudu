import { describe, expect, it } from 'vitest';
import { generateSigningKey, signJwt, verifyJwt, type SigningKeyRecord } from '@odudu/crypto';
import {
  LOGOUT_TOKEN_LIFETIME_SECONDS,
  LOGOUT_TOKEN_TYP,
  logoutTokenClaims,
} from '#/service/logout-token';

const KEK = new Uint8Array(32).fill(7);

async function makeSigningKey(): Promise<SigningKeyRecord> {
  const generated = await generateSigningKey('RS256', KEK);
  return {
    id: 'key-1',
    realmId: 'realm-1',
    kid: generated.kid,
    alg: generated.alg,
    status: 'active',
    publicJwk: generated.publicJwk,
    privateJwkEncrypted: generated.privateJwkEncrypted,
    createdAt: new Date(),
    notAfter: null,
  };
}

describe('logoutTokenClaims', () => {
  const claims = logoutTokenClaims({
    issuer: 'https://op.example/realms/demo',
    audience: 'rp-one',
    subject: 'subject-1',
    sessionId: 'session-1',
    now: new Date('2026-09-19T10:00:00Z'),
  });

  it('[OIDC-BACKCHANNEL-2.4-01] carries iss, the Issuer Identifier', () => {
    expect(claims.iss).toBe('https://op.example/realms/demo');
  });

  it('[OIDC-BACKCHANNEL-2.4-02] carries aud', () => {
    expect(claims.aud).toBe('rp-one');
  });

  it('[OIDC-BACKCHANNEL-2.4-03] carries iat as the event time, in epoch seconds', () => {
    expect(claims.iat).toBe(1789812000);
  });

  it('[OIDC-BACKCHANNEL-2.4-04] carries exp no more than two minutes after iat', () => {
    expect(claims.exp - claims.iat).toBe(LOGOUT_TOKEN_LIFETIME_SECONDS);
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(120);
  });

  it('[OIDC-BACKCHANNEL-2.4-05] carries a jti unique to each token minted', () => {
    expect(claims.jti).toMatch(/^[0-9a-f-]{36}$/u);
    const other = logoutTokenClaims({
      issuer: 'https://op.example/realms/demo',
      audience: 'rp-one',
      subject: 'subject-1',
      sessionId: 'session-1',
      now: new Date('2026-09-19T10:00:00Z'),
    });
    expect(other.jti).not.toBe(claims.jti);
  });

  it('[OIDC-BACKCHANNEL-2.4-06] carries the events member, as an object containing the empty object', () => {
    expect(claims.events).toEqual({
      'http://schemas.openid.net/event/backchannel-logout': {},
    });
  });

  it('[OIDC-BACKCHANNEL-2.4-07] carries both sub and sid', () => {
    expect(claims.sub).toBe('subject-1');
    expect(claims.sid).toBe('session-1');
  });

  it('[OIDC-BACKCHANNEL-2.4-08] carries no nonce', () => {
    expect('nonce' in claims).toBe(false);
  });
});

describe('signing a logout token', () => {
  it('[OIDC-BACKCHANNEL-2.4-09] carries typ: logout+jwt in the header, not the payload', async () => {
    const key = await makeSigningKey();
    const claims = logoutTokenClaims({
      issuer: 'https://op.example/realms/demo',
      audience: 'rp-one',
      subject: 'subject-1',
      sessionId: 'session-1',
      now: new Date(),
    });

    const token = await signJwt({ ...claims }, { key, kek: KEK, typ: LOGOUT_TOKEN_TYP });

    // verifyJwt reads `typ` off the protected header, never the payload
    // (packages/crypto/src/service/sign.ts's `checkTyp`), so a match here
    // proves the header carries it. `claims` itself never carries a `typ`
    // member, so there is nothing for the payload to leak it through.
    const payload = await verifyJwt(token, {
      keys: [key],
      issuer: claims.iss,
      audience: claims.aud,
      typ: LOGOUT_TOKEN_TYP,
    });
    expect(payload.jti).toBe(claims.jti);
    expect('typ' in payload).toBe(false);

    await expect(
      verifyJwt(token, { keys: [key], issuer: claims.iss, audience: claims.aud, typ: 'at+jwt' }),
    ).rejects.toThrow();
  });
});
