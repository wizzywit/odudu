import { describe, expect, it } from 'vitest';
import { baseHostOf, isExemptPath, requestHost, rewriteForDomain } from '#/host-rules';

const raw = (headers: Record<string, string>) => ({ headers });

describe('requestHost', () => {
  it('reads the Host header in its canonical spelling', () => {
    expect(requestHost(raw({ host: 'LOGIN.Acme.com.:443' }), false)).toBe('login.acme.com');
    expect(requestHost(raw({ host: 'login.acme.com:80' }), false)).toBe('login.acme.com');
  });

  it('matches nothing for a port that is not a default one, an address or no Host', () => {
    expect(requestHost(raw({ host: 'login.acme.com:8443' }), false)).toBeNull();
    expect(requestHost(raw({ host: '127.0.0.1' }), false)).toBeNull();
    expect(requestHost(raw({ host: '[::1]:3000' }), false)).toBeNull();
    expect(requestHost(raw({}), false)).toBeNull();
  });

  it('ignores X-Forwarded-Host while the proxy is not trusted', () => {
    const headers = { host: 'evil.test', 'x-forwarded-host': 'login.acme.com' };
    expect(requestHost(raw(headers), false)).toBe('evil.test');
  });

  it('takes the last X-Forwarded-Host entry, the one the trusted proxy appended', () => {
    const headers = { host: 'internal.test', 'x-forwarded-host': 'spoof.example, Login.Acme.com' };
    expect(requestHost(raw(headers), true)).toBe('login.acme.com');
  });

  it('never takes an entry the client could have written ahead of the proxy', () => {
    const headers = { host: 'internal.test', 'x-forwarded-host': 'login.acme.com, spoof.example' };
    expect(requestHost(raw(headers), true)).toBe('spoof.example');
  });

  it('does not fall back to Host when the forwarded value is unusable', () => {
    const headers = { host: 'login.acme.com', 'x-forwarded-host': 'login.acme.com:9999' };
    expect(requestHost(raw(headers), true)).toBeNull();
  });

  it('names no host for a forwarded value that ends in an empty entry', () => {
    const headers = { host: 'login.acme.com', 'x-forwarded-host': 'login.acme.com,' };
    expect(requestHost(raw(headers), true)).toBeNull();
  });

  it('uses Host when a trusted proxy sent no forwarded one', () => {
    expect(requestHost(raw({ host: 'login.acme.com' }), true)).toBe('login.acme.com');
  });
});

describe('baseHostOf', () => {
  it('is the canonical host of the configured base, whatever its port', () => {
    expect(baseHostOf('https://Id.Odudu.example')).toBe('id.odudu.example');
    expect(baseHostOf('https://id.odudu.example:8443/')).toBe('id.odudu.example');
  });

  it('is null for an address, where no domain can collide', () => {
    expect(baseHostOf('http://127.0.0.1:3000')).toBeNull();
    expect(baseHostOf('http://localhost:3090')).toBeNull();
  });
});

describe('isExemptPath', () => {
  it.each([
    '/health',
    '/health/live',
    '/health/ready?x=1',
    '/internal/domain-check',
    '/internal/domain-check?domain=a.b.co',
  ])('exempts %s', (url) => {
    expect(isExemptPath(url)).toBe(true);
  });

  it.each([
    '/',
    '/healthy',
    '/healthz',
    '/internal',
    '/internal/domain-check/x',
    '/internal/other',
    '/tenants/acme/health',
    '/protocol/openid-connect/auth',
    '//health',
  ])('does not exempt %s', (url) => {
    expect(isExemptPath(url)).toBe(false);
  });
});

describe('rewriteForDomain', () => {
  it('puts every path under the tenant, query kept', () => {
    expect(rewriteForDomain('/protocol/openid-connect/auth?client_id=a&x=%2F', 'acme')).toBe(
      '/tenants/acme/protocol/openid-connect/auth?client_id=a&x=%2F',
    );
    expect(rewriteForDomain('/.well-known/openid-configuration', 'acme')).toBe(
      '/tenants/acme/.well-known/openid-configuration',
    );
    expect(rewriteForDomain('/login-actions/authenticate', 'acme')).toBe(
      '/tenants/acme/login-actions/authenticate',
    );
  });

  it('leaves a path that already names a tenant under this one, where nothing serves it', () => {
    expect(rewriteForDomain('/tenants/other/x', 'acme')).toBe('/tenants/acme/tenants/other/x');
    expect(rewriteForDomain('/admin/tenants/acme', 'acme')).toBe(
      '/tenants/acme/admin/tenants/acme',
    );
  });

  it('refuses a target that is not an origin-form path', () => {
    expect(rewriteForDomain('*', 'acme')).toBeNull();
    expect(rewriteForDomain('http://login.acme.com/x', 'acme')).toBeNull();
    expect(rewriteForDomain('', 'acme')).toBeNull();
    expect(rewriteForDomain('?x=1', 'acme')).toBeNull();
  });

  it('encodes the tenant name as a path segment', () => {
    expect(rewriteForDomain('/x', 'a b')).toBe('/tenants/a%20b/x');
  });
});
