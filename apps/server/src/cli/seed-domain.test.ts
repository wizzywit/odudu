import { describe, expect, it } from 'vitest';
import { DOMAIN_CODES } from '@odudu/domain-tenant';
import { domainRefusalMessage, parseSeedDomainArgs } from '#/cli/seed-domain';

describe('seed domain options', () => {
  it('needs a tenant and a host', () => {
    expect(() => parseSeedDomainArgs(['--host', 'login.acme.org'], 'development')).toThrow(
      /--tenant and --host/,
    );
    expect(() => parseSeedDomainArgs(['--tenant', 'acme'], 'development')).toThrow(
      /--tenant and --host/,
    );
  });

  it('reads the flags', () => {
    expect(
      parseSeedDomainArgs(
        ['--tenant', 'acme', '--host', 'login.acme.org', '--canonical', '--assume-verified'],
        'test',
      ),
    ).toEqual({
      tenant: 'acme',
      host: 'login.acme.org',
      canonical: true,
      assumeVerified: true,
    });
  });

  it('refuses --assume-verified in production, before anything else', () => {
    expect(() =>
      parseSeedDomainArgs(
        ['--tenant', 'acme', '--host', 'login.acme.org', '--assume-verified'],
        'production',
      ),
    ).toThrow(expect.objectContaining({ code: 'domain_assume_verified_production' }));
  });

  it('allows a plain registration in production', () => {
    expect(
      parseSeedDomainArgs(['--tenant', 'acme', '--host', 'login.acme.org'], 'production'),
    ).toMatchObject({ assumeVerified: false, canonical: false });
  });
});

describe('the sentence a refused domain is explained in', () => {
  it('keeps the code first and says something for every code', () => {
    for (const code of Object.values(DOMAIN_CODES)) {
      const message = domainRefusalMessage(code, 'login.acme.org');
      expect(message.startsWith(`${code}: `), code).toBe(true);
      expect(message.length, code).toBeGreaterThan(code.length + 20);
      expect(message, code).not.toContain('was refused');
    }
  });

  it('names the setting a missing base address asks for', () => {
    expect(domainRefusalMessage(DOMAIN_CODES.noBaseUrl, 'login.acme.org')).toContain(
      'ODUDU_PUBLIC_BASE_URL',
    );
  });
});
