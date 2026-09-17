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

  // The registry's own wording for `otp` does not rule this out, but
  // reporting a stored, printed-or-saved recovery code as `otp` would
  // still claim a generator-produced code — a stronger assurance than a
  // recovery code supports (docs/protocols/oidc-core.md's reading note has
  // the full argument). No other value fits either, so it emits nothing.
  it('emits nothing for a recovery code, which otp would misrepresent', () => {
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

  it('is null for an empty record — no authenticator to state a factor count about', () => {
    expect(acrFor([])).toBeNull();
  });

  // OIDC Core §2's acr MUST — "a registered name is not used with a
  // different meaning than the one it is registered with" — binds only a
  // value that names an RFC 6711 registration. This is vacuously satisfied
  // rather than actively guarded: asserted over inputs including an
  // authenticator name the mapping above knows nothing about, so a future
  // change that starts naming a registered value here would fail it.
  it('[OIDC-CORE-2-09] never emits an RFC 6711 registered name, over any input', () => {
    for (const authenticators of [[], ['password'], ['passkey'], ['x', 'y', 'z']]) {
      const acr = acrFor(authenticators);
      expect(acr === null || /^[12]$/.test(acr)).toBe(true);
    }
  });
});
