import { describe, expect, it } from 'vitest';
import { consoleAddressOf } from '#/service/tenant-address';

describe('consoleAddressOf', () => {
  it('is the path address on the base for a tenant with no canonical domain', () => {
    expect(consoleAddressOf(new URL('https://idp.example'), 'acme', null)).toEqual({
      origin: 'https://idp.example',
      prefix: '/tenants/acme',
    });
  });

  it('keeps the base port on the path address', () => {
    expect(consoleAddressOf(new URL('http://localhost:3000'), 'acme', null)).toEqual({
      origin: 'http://localhost:3000',
      prefix: '/tenants/acme',
    });
  });

  it('is the root of the canonical domain, over the scheme the base uses', () => {
    expect(consoleAddressOf(new URL('https://idp.example'), 'acme', 'login.acme.com')).toEqual({
      origin: 'https://login.acme.com',
      prefix: '',
    });
    expect(consoleAddressOf(new URL('http://idp.test'), 'acme', 'login.acme.test')).toEqual({
      origin: 'http://login.acme.test',
      prefix: '',
    });
  });
});
