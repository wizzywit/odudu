import { CONSOLE_ROOT } from '#/shared/services/address';
import { describe, expect, it } from 'vitest';
import { loginUrl, signOutDestination } from '#/features/session/services/loginUrl';

describe('the sign-in URL', () => {
  it('names the tenant and the return path, both encoded', () => {
    const url = new URL(loginUrl('acme', '/console/acme/clients?tab=a&b=c'), location.origin);
    expect(url.pathname).toBe('/console/auth/login');
    expect(url.searchParams.get('tenant')).toBe('acme');
    expect(url.searchParams.get('return_to')).toBe('/console/acme/clients?tab=a&b=c');
  });

  it('never carries a return path outside the console', () => {
    const url = new URL(loginUrl('acme', 'https://evil.example/'), location.origin);
    expect(url.searchParams.get('return_to')).toBe('/console/');
  });
});

describe('where a sign-out leaves for', () => {
  it('is the address the gateway named, else the console root', () => {
    expect(signOutDestination({ ok: true, redirect: '/console/auth/bye' })).toBe(
      '/console/auth/bye',
    );
    expect(signOutDestination({ ok: false, kind: 'network' })).toBe(CONSOLE_ROOT);
    expect(CONSOLE_ROOT).toBe('/console/');
  });
});
