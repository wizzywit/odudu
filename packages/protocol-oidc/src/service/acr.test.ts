import { describe, expect, it } from 'vitest';
import { acrFor, amrFor } from '#/service/acr';

describe('amrFor', () => {
  it('maps each authenticator to its registered RFC 8176 value', () => {
    expect(amrFor(['password'])).toEqual(['pwd']);
    expect(amrFor(['otp'])).toEqual(['otp']);
    expect(amrFor(['passkey'])).toEqual(['hwk', 'user']);
  });

  it('de-duplicates and keeps a stable order for a multi-factor login', () => {
    expect(amrFor(['password', 'otp'])).toEqual(['otp', 'pwd']);
  });

  it('omits an authenticator with no registered value rather than inventing one', () => {
    expect(amrFor(['password', 'something-local'])).toEqual(['pwd']);
  });

  // RFC 8176 §2 ties `otp` to RFC 4226/6238 — an algorithmically generated
  // one-time password, checked once and never reusable in the same way
  // again. A recovery code is a pre-generated, statically stored value from
  // a fixed list, not an OTP-algorithm output, so it has no accurate entry
  // in the registry (see docs/protocols/oidc-core.md's reading note). The
  // rule this holds is the brief's own: an unregistered meaning emits
  // nothing rather than a guess.
  it('emits nothing for a recovery code, which is not what RFC 8176 registers as otp', () => {
    expect(amrFor(['recovery-code'])).toEqual([]);
  });
});

describe('acrFor', () => {
  it('is 1 for one factor and 2 for two', () => {
    expect(acrFor(['password'])).toBe('1');
    expect(acrFor(['password', 'otp'])).toBe('2');
  });

  it('is 2 for a passkey alone, which is already two factors', () => {
    expect(acrFor(['passkey'])).toBe('2');
  });

  // OIDC Core §2's acr MUST — "a registered name is not used with a
  // different meaning than the one it is registered with" — binds only a
  // value that names an RFC 6711 registration. `acrFor` never emits one:
  // its output is always this realm's own bare digit, so there is no
  // registered name here for the MUST to be violated against.
  it('[OIDC-CORE-2-09] never emits an RFC 6711 registered name', () => {
    expect(acrFor([])).toBe('1');
    expect(acrFor(['password'])).toBe('1');
    expect(acrFor(['password', 'otp'])).toBe('2');
    expect(acrFor(['passkey'])).toBe('2');
  });
});
