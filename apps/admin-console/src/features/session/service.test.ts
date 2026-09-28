import { describe, expect, it } from 'vitest';
import { draftOwner, isTenantName, loginUrl, returnPath } from '#/features/session/service.ts';

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

describe('a tenant name', () => {
  it.each(['acme', 'system', 'a', 'eu-west-1', 'x'.repeat(63)])('accepts %j', (name) => {
    expect(isTenantName(name)).toBe(true);
  });

  it.each(['', 'Acme', '-acme', 'acme-', 'ac me', 'ac/me', 'x'.repeat(64), 'ac.me'])(
    'refuses %j',
    (name) => {
      expect(isTenantName(name)).toBe(false);
    },
  );
});

it('keys drafts by the administrator and the tenant they signed in to', () => {
  expect(draftOwner({ tenant: 'acme', subjectId: 's1', username: 'grace' })).toBe('acme/s1');
});
