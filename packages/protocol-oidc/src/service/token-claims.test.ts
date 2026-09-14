import { describe, expect, it } from 'vitest';
import { withRegisteredClaimsWinning } from '#/service/token-claims';

describe('withRegisteredClaimsWinning', () => {
  it('keeps a registered claim when a mapper tries to overwrite it', () => {
    const mapped = { sub: 'attacker-controlled', roles: ['admin'] };
    const registered = { sub: 'the-real-subject', iss: 'https://issuer.example' };

    expect(withRegisteredClaimsWinning(mapped, registered)).toEqual({
      sub: 'the-real-subject',
      iss: 'https://issuer.example',
      roles: ['admin'],
    });
  });

  it('keeps a mapper claim that names nothing registered', () => {
    const mapped = { roles: ['admin'] };
    const registered = { sub: 's' };

    expect(withRegisteredClaimsWinning(mapped, registered)).toEqual({
      roles: ['admin'],
      sub: 's',
    });
  });

  // The ID token site applies this same helper 83 lines away from the
  // access token's, over its own envelope — iss/sub/aud/iat/exp/nonce
  // rather than iss/sub/aud/exp/iat/jti/client_id/scope. Reversing the
  // spread order at that call site would let a mapper substitute its own
  // nonce, which is exactly what this would fail to catch if written the
  // other way around.
  it('keeps the ID token envelope claims a mapper could otherwise overwrite', () => {
    const mapped = { nonce: 'attacker-controlled', name: 'Ada' };
    const registered = {
      iss: 'https://issuer.example',
      sub: 'the-real-subject',
      aud: 'the-client',
      iat: 1,
      exp: 2,
      nonce: 'the-real-nonce',
    };

    expect(withRegisteredClaimsWinning(mapped, registered)).toEqual({
      name: 'Ada',
      iss: 'https://issuer.example',
      sub: 'the-real-subject',
      aud: 'the-client',
      iat: 1,
      exp: 2,
      nonce: 'the-real-nonce',
    });
  });
});
