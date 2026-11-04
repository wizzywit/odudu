import { describe, expect, it } from 'vitest';
import {
  addressIssuer,
  addressPath,
  addressRelyingParty,
  addressUrl,
  domainAddress,
  isAddressLiteral,
  pathAddress,
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
