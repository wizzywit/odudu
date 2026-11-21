import { describe, expect, it } from 'vitest';
import { resolveOptions, withTenant } from '#/services/request';

const base = { baseUrl: 'https://id.example.com', token: 'super-secret-token' };

describe('resolveOptions', () => {
  it.each([
    ['empty', ''],
    ['a dot', '.'],
    ['two dots', '..'],
    ['a slash', 'a/b'],
    ['a backslash', 'a\\b'],
    ['an encoded dot segment', '%2e%2e'],
    ['a control character', 'a\u0000b'],
    ['a newline', 'a\nb'],
  ])('refuses a tenant that is %s, without echoing the token', (_name, tenant) => {
    const attempt = (): unknown => resolveOptions({ ...base, tenant });
    expect(attempt).toThrow(TypeError);
    expect(attempt).toThrow(/tenant/u);
    expect(attempt).not.toThrow(/super-secret/u);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, '30'])(
    'refuses a timeoutMs of %s',
    (timeoutMs) => {
      const attempt = (): unknown =>
        resolveOptions({ ...base, tenant: 'acme', timeoutMs: timeoutMs as number });
      expect(attempt).toThrow(TypeError);
      expect(attempt).toThrow(/timeoutMs/u);
    },
  );

  it('takes 30 seconds when no timeoutMs is given, and any finite positive one', () => {
    expect(resolveOptions({ ...base, tenant: 'acme' }).timeoutMs).toBe(30_000);
    expect(resolveOptions({ ...base, tenant: 'acme', timeoutMs: 250 }).timeoutMs).toBe(250);
  });

  it('accepts an ordinary tenant name', () => {
    expect(resolveOptions({ ...base, tenant: 'acme-corp.eu' }).tenant).toBe('acme-corp.eu');
  });
});

describe('withTenant', () => {
  it.each(['.', '..'])('refuses the path parameter %s', (id) => {
    expect(() => withTenant({ params: { path: { id } } }, 'acme')).toThrow(/path parameter "id"/u);
  });

  it('keeps other path parameters and overrides a caller tenant', () => {
    const init = withTenant({ params: { path: { id: 'c1', tenant: 'other' } } }, 'acme');
    expect(init).toEqual({ params: { path: { id: 'c1', tenant: 'acme' } } });
  });

  it('removes what would let a call leave the client origin, redirect policy or transport', () => {
    const init = withTenant(
      {
        baseUrl: 'https://evil.test',
        fetch: () => Promise.resolve(new Response()),
        redirect: 'follow',
        middleware: [],
        pathSerializer: () => '/x',
        body: { a: 1 },
        params: { header: { 'Idempotency-Key': 'mine' } },
      },
      'acme',
    );
    expect(Object.keys(init).sort()).toEqual(['body', 'params']);
    expect(init.params).toMatchObject({ header: { 'Idempotency-Key': 'mine' } });
  });
});
