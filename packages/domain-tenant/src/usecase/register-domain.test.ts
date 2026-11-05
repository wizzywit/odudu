import { describe, expect, it, vi } from 'vitest';
import { DomainConflictError, type DomainRow, type NewDomain } from '#/repository/tenant-domains';
import { SYSTEM_TENANT_ID } from '#/service/admin-capabilities';
import { registerDomain, type RegisterDomainDeps } from '#/usecase/register-domain';

const acme = { id: 'tenant-1', name: 'acme' };
const BYTES = Buffer.alloc(32, 7);

function setup(over: Partial<RegisterDomainDeps> = {}) {
  const insert = vi.fn((input: NewDomain): Promise<DomainRow> =>
    Promise.resolve({
      id: 'd1',
      tenantId: input.tenantId,
      host: input.host,
      state: 'pending',
      challenge: input.challenge,
      verifiedAt: null,
      lastCheckedAt: null,
      failedChecks: 0,
      canonical: false,
    }),
  );
  const deps: RegisterDomainDeps = {
    domains: { insert },
    publicBaseUrl: 'https://id.operator.net',
    random: () => BYTES,
    ...over,
  };
  return { insert, deps };
}

describe('registerDomain', () => {
  it('stores the canonical host and names the record to publish', async () => {
    const { deps, insert } = setup();
    const out = await registerDomain(deps, acme, 'LOGIN.Acme.com.:443');
    expect(insert).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      host: 'login.acme.com',
      challenge: `odudu-domain-verification=${BYTES.toString('base64url')}`,
    });
    expect(out).toMatchObject({
      kind: 'registered',
      recordName: '_odudu-challenge.login.acme.com',
      recordValue: `odudu-domain-verification=${BYTES.toString('base64url')}`,
    });
  });

  it('refuses the system tenant', async () => {
    const { deps, insert } = setup();
    const out = await registerDomain(deps, { id: SYSTEM_TENANT_ID, name: 'system' }, 'a.acme.com');
    expect(out).toEqual({ kind: 'refused', code: 'domain_system_tenant' });
    expect(insert).not.toHaveBeenCalled();
  });

  it('refuses every registration without a public base URL', async () => {
    const { deps, insert } = setup({ publicBaseUrl: undefined });
    expect(await registerDomain(deps, acme, 'login.acme.com')).toEqual({
      kind: 'refused',
      code: 'domain_no_base_url',
    });
    expect(insert).not.toHaveBeenCalled();
  });

  it.each([
    ['192.0.2.1', 'domain_host_ip_literal'],
    ['[::1]', 'domain_host_ip_literal'],
    ['localhost', 'domain_host_localhost'],
    ['a.test', 'domain_host_reserved'],
    ['id.operator.net', 'domain_host_operator'],
    ['login.acme.com:8443', 'domain_host_invalid'],
    ['acme', 'domain_host_invalid'],
  ])('refuses %s with %s', async (host, code) => {
    const { deps, insert } = setup();
    expect(await registerDomain(deps, acme, host)).toEqual({ kind: 'refused', code });
    expect(insert).not.toHaveBeenCalled();
  });

  it('allows a subdomain of the operator host', async () => {
    const { deps } = setup();
    expect(await registerDomain(deps, acme, 'acme.id.operator.net')).toMatchObject({
      kind: 'registered',
    });
  });

  it.each([
    ['limit', 'domain_limit'],
    ['already_registered', 'domain_already_registered'],
    ['host_verified_elsewhere', 'domain_verified_elsewhere'],
  ] as const)('maps a %s conflict to %s', async (reason, code) => {
    const { deps, insert } = setup();
    insert.mockRejectedValue(new DomainConflictError(reason, 'login.acme.com'));
    expect(await registerDomain(deps, acme, 'login.acme.com')).toEqual({ kind: 'refused', code });
  });

  it('lets any other failure through', async () => {
    const { deps, insert } = setup();
    insert.mockRejectedValue(new Error('connection lost'));
    await expect(registerDomain(deps, acme, 'login.acme.com')).rejects.toThrow('connection lost');
  });
});
