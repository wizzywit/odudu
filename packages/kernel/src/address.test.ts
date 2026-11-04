import { describe, expect, it } from 'vitest';
import {
  addressIssuer,
  addressPath,
  addressRelyingParty,
  addressUrl,
  domainAddress,
  isAddressLiteral,
  pathAddress,
  routeAddress,
  tenantAddressOf,
} from '#/address';

describe('pathAddress', () => {
  const a = pathAddress('https://idp.example', 'acme');

  it('puts the tenant under /tenants/<name>', () => {
    expect(addressIssuer(a)).toBe('https://idp.example/tenants/acme');
    expect(addressPath(a, '/login-actions/authenticate')).toBe(
      '/tenants/acme/login-actions/authenticate',
    );
    expect(addressUrl(a, '/login-actions/authenticate')).toBe(
      'https://idp.example/tenants/acme/login-actions/authenticate',
    );
  });

  it('keeps a name that is not one path segment to one', () => {
    expect(pathAddress('https://idp.example', 'a b/../c').prefix).toBe('/tenants/a%20b%2F..%2Fc');
  });

  it('tolerates a trailing slash on the base', () => {
    expect(addressIssuer(pathAddress('https://idp.example/', 'acme'))).toBe(
      'https://idp.example/tenants/acme',
    );
  });

  it('names the host without a port as the relying party id, and keeps the port in its origin', () => {
    expect(addressRelyingParty(a)).toEqual({ id: 'idp.example', origin: 'https://idp.example' });
    expect(addressRelyingParty(pathAddress('http://idp.example:3000', 'acme'))).toEqual({
      id: 'idp.example',
      origin: 'http://idp.example:3000',
    });
  });
});

describe('domainAddress', () => {
  it('serves the routes at the root of the host', () => {
    const a = domainAddress('login.acme.com', true);
    expect(addressIssuer(a)).toBe('https://login.acme.com');
    expect(addressPath(a, '/login-actions/authenticate')).toBe('/login-actions/authenticate');
    expect(addressUrl(a, '/login-actions/authenticate')).toBe(
      'https://login.acme.com/login-actions/authenticate',
    );
    expect(addressRelyingParty(a)).toEqual({
      id: 'login.acme.com',
      origin: 'https://login.acme.com',
    });
  });

  it('uses http without TLS', () => {
    expect(addressIssuer(domainAddress('login.acme.test', false))).toBe('http://login.acme.test');
  });
});

describe('isAddressLiteral', () => {
  it('recognises IPv4 and IPv6 hosts and no domain', () => {
    expect(isAddressLiteral('127.0.0.1')).toBe(true);
    expect(isAddressLiteral('[::1]')).toBe(true);
    expect(isAddressLiteral('idp.example')).toBe(false);
    expect(isAddressLiteral('localhost')).toBe(false);
  });
});

describe('tenantAddressOf', () => {
  it('returns the address a request carries', () => {
    const a = pathAddress('https://idp.example', 'acme');
    expect(tenantAddressOf({ tenantAddress: a })).toBe(a);
  });

  it('refuses a request outside a tenant', () => {
    expect(() => tenantAddressOf({ tenantAddress: undefined })).toThrow('no tenant address');
  });
});

describe('routeAddress', () => {
  it('names the tenant of a route segment', () => {
    expect(routeAddress({ tenant: 'acme' }, 'https://idp.example')).toEqual(
      pathAddress('https://idp.example', 'acme'),
    );
  });

  it('is undefined where no segment names a tenant', () => {
    expect(routeAddress({}, 'https://idp.example')).toBeUndefined();
    expect(routeAddress(undefined, 'https://idp.example')).toBeUndefined();
    expect(routeAddress({ tenant: 7 }, 'https://idp.example')).toBeUndefined();
  });
});
