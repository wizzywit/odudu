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
});
