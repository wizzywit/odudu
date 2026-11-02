import { describe, expect, it } from 'vitest';
import { returnPath } from '#/features/session/services/returnPath';

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
