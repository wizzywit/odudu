import { describe, expect, it } from 'vitest';
import {
  loginUrl,
  returnPath,
  CONSOLE_ROOT,
  signOutDestination,
} from '#/features/session/service/address.ts';

describe('the return path a sign-in comes back to', () => {
  it('is the console page the administrator was on, query kept and fragment dropped', () => {
    expect(returnPath('/console/acme/clients/c1?tab=tokens#top')).toBe(
      '/console/acme/clients/c1?tab=tokens',
    );
    expect(returnPath('/console/')).toBe('/console/');
    expect(returnPath('/console')).toBe('/console/');
  });

  it.each([
    'https://evil.example/console/',
    '//evil.example/console/',
    '/\\evil.example/console/',
    '/elsewhere',
    '/consoles/acme',
    '/console/../admin/tenants',
    '/console/%2e%2e/admin',
    '/console/acme/%2E%2e/%2e./api/session',
    '/console/auth/login?tenant=acme',
    '/console/auth/logout',
    '/console/api/session',
    'javascript:alert(1)',
    '/console/acme%25/clients',
    '/console/acme/%0d%0aset-cookie',
    '/console/acme/%1F',
    '/console/acme/%7f',
    '/console/acme/\x7f',
    '/console/acme/\x01',
    '',
  ])('is the console root instead of %j', (asked) => {
    expect(returnPath(asked)).toBe('/console/');
  });
});

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
