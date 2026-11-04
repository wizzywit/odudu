import { describe, expect, it } from 'vitest';
import { parseSeedDomainArgs } from '#/cli/seed-domain';

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
