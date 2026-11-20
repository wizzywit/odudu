import { describe, expect, it } from 'vitest';
import { sessionOf } from '#/services/claims';

describe('sessionOf', () => {
  it('reads the claims of a signed-in answer', () => {
    expect(sessionOf({ authenticated: true, claims: { sub: 'a', name: 'Ada' } })).toEqual({
      claims: { sub: 'a', name: 'Ada' },
    });
  });

  it.each([
    undefined,
    null,
    'text',
    {},
    { authenticated: false },
    { authenticated: true },
    { authenticated: true, claims: null },
    { authenticated: true, claims: 'x' },
    { authenticated: true, claims: [] },
    { authenticated: true, claims: {} },
    { authenticated: 'yes', claims: { sub: 'a' } },
  ])('reads %j as signed out', (body) => {
    expect(sessionOf(body)).toBeNull();
  });
});
