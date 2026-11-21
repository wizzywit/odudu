import { describe, expect, it } from 'vitest';
import { addressIssuer, domainAddress, pathAddress } from '#/services/address';

describe('tenant addresses', () => {
  it('puts a tenant under the instance at /tenants/<name>, encoded as one segment', () => {
    expect(pathAddress('https://id.example.com', 'acme')).toEqual({
      origin: 'https://id.example.com',
      prefix: '/tenants/acme',
    });
    expect(pathAddress('https://id.example.com', 'a b/c').prefix).toBe('/tenants/a%20b%2Fc');
  });

  it('drops trailing slashes of the base', () => {
    expect(pathAddress('https://id.example.com///', 'acme').origin).toBe('https://id.example.com');
  });

  it('gives a domain address no path, over TLS or not', () => {
    expect(domainAddress('login.acme.test', true)).toEqual({
      origin: 'https://login.acme.test',
      prefix: '',
    });
    expect(domainAddress('localhost:3000', false).origin).toBe('http://localhost:3000');
  });

  it('joins the origin and the prefix into the issuer', () => {
    expect(addressIssuer(pathAddress('https://id.example.com', 'acme'))).toBe(
      'https://id.example.com/tenants/acme',
    );
    expect(addressIssuer(domainAddress('login.acme.test', true))).toBe('https://login.acme.test');
  });
});
