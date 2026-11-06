import { describe, expect, it } from 'vitest';
import { stdioTarget } from '#/service/stdio-target';

describe('the instance and tenant a stdio server is configured for', () => {
  it('derives the issuer, the metadata address and admin addresses from the base URL and tenant', () => {
    const target = stdioTarget('https://id.example.com/', 'acme');
    expect(target.issuer).toBe('https://id.example.com/tenants/acme');
    expect(target.metadataUrl).toBe(
      'https://id.example.com/.well-known/oauth-authorization-server/tenants/acme',
    );
    expect(target.tenant).toBe('acme');
    expect(target.adminUrl('/admin/tenants/acme/whoami')).toBe(
      'https://id.example.com/admin/tenants/acme/whoami',
    );
  });

  it('encodes the tenant as one path segment', () => {
    expect(stdioTarget('https://id.example.com', 'a b').issuer).toBe(
      'https://id.example.com/tenants/a%20b',
    );
  });

  it.each(['http://localhost:3000', 'http://127.0.0.1:3000', 'http://[::1]:3000'])(
    'allows plain HTTP only for a loopback address: %s',
    (base) => {
      expect(stdioTarget(base, 'acme').issuer).toBe(`${base}/tenants/acme`);
    },
  );

  it('refuses plain HTTP to any other host', () => {
    expect(() => stdioTarget('http://id.example.com', 'acme')).toThrow(/https/u);
    expect(() => stdioTarget('http://127.0.0.1.example.com', 'acme')).toThrow(/https/u);
  });

  it.each([
    'not a url',
    'ftp://id.example.com',
    'https://user:pw@id.example.com',
    'https://id.example.com/sub',
    'https://id.example.com/?x=1',
    'https://id.example.com/#frag',
  ])('refuses %s', (base) => {
    expect(() => stdioTarget(base, 'acme')).toThrow();
  });

  it('refuses an empty tenant', () => {
    expect(() => stdioTarget('https://id.example.com', '')).toThrow(/tenant/u);
  });

  it('does not put the base URL in a message about a credential', () => {
    expect(() => stdioTarget('https://user:hunter2@id.example.com', 'acme')).not.toThrow(
      /hunter2/u,
    );
  });
});
