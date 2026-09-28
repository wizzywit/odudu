import { afterEach, expect, it } from 'vitest';
import { rememberedTenant } from '#/features/session/repository/useSessionQuery.ts';

afterEach(() => {
  localStorage.clear();
});

it('offers the last tenant only when the URL names none and nobody is signed in', () => {
  localStorage.setItem('odudu.console.tenant', 'acme');
  expect(rememberedTenant({ named: null, signedIn: false })).toBe('acme');
  expect(rememberedTenant({ named: 'beta', signedIn: false })).toBeNull();
  expect(rememberedTenant({ named: null, signedIn: true })).toBeNull();
});

it('offers nothing when no tenant was remembered', () => {
  expect(rememberedTenant({ named: null, signedIn: false })).toBeNull();
});
