import { describe, expect, it } from 'vitest';
import { assembleJwks, toPublicJwk } from '#/service/jwks';

const PRIVATE_MEMBERS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'k'];

const rsa = {
  kty: 'RSA',
  n: 'n-value',
  e: 'AQAB',
  d: 'D',
  p: 'P',
  q: 'Q',
  dp: 'DP',
  dq: 'DQ',
  qi: 'QI',
};

describe('[RFC7517-4-01] published JWKs carry no private material', () => {
  it('strips every private member from an RSA key', () => {
    const pub = toPublicJwk(rsa, '2026-09-a', 'RS256');
    for (const member of PRIVATE_MEMBERS) expect(pub).not.toHaveProperty(member);
    expect(pub).toMatchObject({
      kty: 'RSA',
      n: 'n-value',
      e: 'AQAB',
      kid: '2026-09-a',
      alg: 'RS256',
      use: 'sig',
    });
  });

  it('strips private members from every key in an assembled set', () => {
    const set = assembleJwks([
      { kid: 'a', alg: 'RS256', publicJwk: rsa },
      { kid: 'b', alg: 'RS256', publicJwk: rsa },
    ]);
    expect(set.keys).toHaveLength(2);
    for (const key of set.keys) {
      for (const member of PRIVATE_MEMBERS) expect(key).not.toHaveProperty(member);
    }
  });

  it('is an allowlist, so an unknown member cannot leak through', () => {
    expect(toPublicJwk({ ...rsa, surprise: 'leak' }, 'a', 'RS256')).not.toHaveProperty('surprise');
  });
});
