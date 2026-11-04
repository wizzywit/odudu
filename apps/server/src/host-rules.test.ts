import { describe, expect, it } from 'vitest';
import {
  baseHostOf,
  isExemptPath,
  previousAddressServes,
  requestHost,
  rewriteForDomain,
  tenantOfPath,
} from '#/host-rules';

const raw = (headers: Record<string, string>) => ({ headers });

describe('requestHost', () => {
  it('reads the Host header in its canonical spelling', () => {
    expect(requestHost(raw({ host: 'LOGIN.Acme.com.:443' }), false, true)).toBe('login.acme.com');
    expect(requestHost(raw({ host: 'login.acme.com:80' }), false, false)).toBe('login.acme.com');
  });

  it('matches nothing for the default port of the other scheme', () => {
    expect(requestHost(raw({ host: 'login.acme.com:80' }), false, true)).toBeNull();
    expect(requestHost(raw({ host: 'login.acme.com:443' }), false, false)).toBeNull();
    const forwarded = { host: 'internal.test', 'x-forwarded-host': 'login.acme.com:80' };
    expect(requestHost(raw(forwarded), true, true)).toBeNull();
  });

  it('matches nothing for a port that is not a default one, an address or no Host', () => {
    expect(requestHost(raw({ host: 'login.acme.com:8443' }), false, true)).toBeNull();
    expect(requestHost(raw({ host: '127.0.0.1' }), false, true)).toBeNull();
    expect(requestHost(raw({ host: '[::1]:3000' }), false, true)).toBeNull();
    expect(requestHost(raw({}), false, true)).toBeNull();
  });

  it('[ODUDU-HOST-FORWARD-01] ignores X-Forwarded-Host while the proxy is not trusted', () => {
    const headers = { host: 'evil.test', 'x-forwarded-host': 'login.acme.com' };
    expect(requestHost(raw(headers), false, true)).toBe('evil.test');
  });

  it('takes the last X-Forwarded-Host entry, the one the trusted proxy appended', () => {
    const headers = { host: 'internal.test', 'x-forwarded-host': 'spoof.example, Login.Acme.com' };
    expect(requestHost(raw(headers), true, true)).toBe('login.acme.com');
  });

  it('[ODUDU-HOST-FORWARD-01] never takes an entry the client could have written ahead of the proxy', () => {
    const headers = { host: 'internal.test', 'x-forwarded-host': 'login.acme.com, spoof.example' };
    expect(requestHost(raw(headers), true, true)).toBe('spoof.example');
  });

  it('does not fall back to Host when the forwarded value is unusable', () => {
    const headers = { host: 'login.acme.com', 'x-forwarded-host': 'login.acme.com:9999' };
    expect(requestHost(raw(headers), true, true)).toBeNull();
  });

  it('names no host for a forwarded value that ends in an empty entry', () => {
    const headers = { host: 'login.acme.com', 'x-forwarded-host': 'login.acme.com,' };
    expect(requestHost(raw(headers), true, true)).toBeNull();
  });

  it('uses Host when a trusted proxy sent no forwarded one', () => {
    expect(requestHost(raw({ host: 'login.acme.com' }), true, true)).toBe('login.acme.com');
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

describe('tenantOfPath', () => {
  it('names the tenant a path address addresses, as the router would decode it', () => {
    expect(tenantOfPath('/tenants/acme/protocol/openid-connect/auth?x=1')).toBe('acme');
    expect(tenantOfPath('/tenants/acme')).toBe('acme');
    expect(tenantOfPath('/tenants/%61cme/jwks')).toBe('acme');
  });

  it('names no tenant for what is not a tenant path or not a valid name', () => {
    expect(tenantOfPath('/health/live')).toBeNull();
    expect(tenantOfPath('/admin/tenants/acme')).toBeNull();
    expect(tenantOfPath('/tenants/')).toBeNull();
    expect(tenantOfPath('/tenants/ACME/x')).toBeNull();
    expect(tenantOfPath('/tenants/a%2Fb/x')).toBeNull();
    expect(tenantOfPath('/tenants/%zz/x')).toBeNull();
    expect(tenantOfPath('/tenants/-a/x')).toBeNull();
  });
});

describe('previousAddressServes', () => {
  const under = (rest: string) => `/tenants/acme${rest}`;

  it.each([
    '/.well-known/openid-configuration',
    '/protocol/openid-connect/token',
    '/protocol/openid-connect/token/introspect',
    '/protocol/openid-connect/revoke',
    '/protocol/openid-connect/userinfo',
    '/protocol/openid-connect/certs',
    '/protocol/openid-connect/logout',
    '/protocol/openid-connect/userinfo?x=1',
    '/brand/abc.png',
    '/brand/c/portal/abc.png',
  ])('keeps serving %s', (rest) => {
    expect(previousAddressServes(under(rest))).toBe(true);
  });

  it.each([
    '/protocol/openid-connect/auth',
    '/login-actions/authenticate',
    '/login-actions/registration',
    '/login-actions/reset-password',
    '/login-actions/action-token',
    '/login-actions/consent',
    '/clients-registrations/openid-connect',
    '/protocol/openid-connect/token/',
    '/protocol/openid-connect/tokens',
    '/protocol/openid-connect/logout/x',
    '/',
    '',
  ])('refuses %s with a pointer to the canonical address', (rest) => {
    expect(previousAddressServes(under(rest))).toBe(false);
  });
});
