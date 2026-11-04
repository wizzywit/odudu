import { describe, expect, it, vi } from 'vitest';
import { DomainConflictError, type DomainRow } from '#/repository/tenant-domains';
import { type ResolveTxt } from '#/service/tenant-domain';
import { verifyDomain } from '#/usecase/verify-domain';

const NOW = new Date('2026-11-04T12:00:00Z');
const CHALLENGE = 'odudu-domain-verification=abc123';

function row(over: Partial<DomainRow> = {}): DomainRow {
  return {
    id: 'd1',
    tenantId: 't1',
    host: 'login.acme.com',
    state: 'pending',
    challenge: CHALLENGE,
    verifiedAt: null,
    lastCheckedAt: null,
    failedChecks: 0,
    canonical: false,
    ...over,
  };
}

function setup(resolveTxt: ResolveTxt, found: DomainRow | null = row()) {
  const domains = {
    get: vi.fn(() => Promise.resolve(found)),
    markVerified: vi.fn(() => Promise.resolve(found)),
    recordCheck: vi.fn(() => Promise.resolve(found)),
  };
  return { domains, deps: { resolveTxt, domains } };
}

const failing = (code: string) => () => Promise.reject(Object.assign(new Error(code), { code }));

describe('verifyDomain', () => {
  it('verifies on an exact match and asks for the challenge name', async () => {
    const resolve = vi.fn<ResolveTxt>(() => Promise.resolve([['other'], [CHALLENGE]]));
    const { deps, domains } = setup(resolve);
    expect(await verifyDomain(deps, 't1', 'd1', NOW)).toBe('verified');
    expect(resolve).toHaveBeenCalledWith('_odudu-challenge.login.acme.com');
    expect(domains.markVerified).toHaveBeenCalledWith('t1', 'd1', NOW);
  });

  it('joins a value split across chunks', async () => {
    const { deps } = setup(() => Promise.resolve([['odudu-domain-', 'verification=abc', '123']]));
    expect(await verifyDomain(deps, 't1', 'd1', NOW)).toBe('verified');
  });

  it.each([
    [`${CHALLENGE}x`],
    [`x${CHALLENGE}`],
    ['odudu-domain-verification=ABC123'],
    [`${CHALLENGE} `],
  ])('stays pending for %j and records the failed check', async (value) => {
    const { deps, domains } = setup(() => Promise.resolve([[value]]));
    expect(await verifyDomain(deps, 't1', 'd1', NOW)).toBe('pending');
    expect(domains.markVerified).not.toHaveBeenCalled();
    expect(domains.recordCheck).toHaveBeenCalledWith('t1', 'd1', false, NOW);
  });

  it.each(['ENOTFOUND', 'ENODATA'])('counts %s as a failed check, pending', async (code) => {
    const { deps, domains } = setup(failing(code));
    expect(await verifyDomain(deps, 't1', 'd1', NOW)).toBe('pending');
    expect(domains.recordCheck).toHaveBeenCalledWith('t1', 'd1', false, NOW);
  });

  it.each(['ETIMEOUT', 'ESERVFAIL', 'ECONNREFUSED', 'EAI_AGAIN'])(
    'leaves a resolver %s pending and counts nothing',
    async (code) => {
      const { deps, domains } = setup(failing(code));
      expect(await verifyDomain(deps, 't1', 'd1', NOW)).toBe('pending');
      expect(domains.markVerified).not.toHaveBeenCalled();
      expect(domains.recordCheck).not.toHaveBeenCalled();
    },
  );

  it('answers a verified row without resolving', async () => {
    const resolve = vi.fn<ResolveTxt>();
    const { deps } = setup(resolve, row({ state: 'verified' }));
    expect(await verifyDomain(deps, 't1', 'd1', NOW)).toBe('verified');
    expect(resolve).not.toHaveBeenCalled();
  });

  it('answers a failed row without resolving', async () => {
    const resolve = vi.fn<ResolveTxt>();
    const { deps } = setup(resolve, row({ state: 'failed' }));
    expect(await verifyDomain(deps, 't1', 'd1', NOW)).toBe('failed');
    expect(resolve).not.toHaveBeenCalled();
  });

  it('answers not_found for a row the tenant does not hold', async () => {
    const { deps } = setup(() => Promise.resolve([]), null);
    expect(await verifyDomain(deps, 't1', 'd1', NOW)).toBe('not_found');
  });

  it('maps another tenant having verified first to a typed outcome', async () => {
    const { deps, domains } = setup(() => Promise.resolve([[CHALLENGE]]));
    domains.markVerified.mockRejectedValue(
      new DomainConflictError('host_verified_elsewhere', 'd1'),
    );
    expect(await verifyDomain(deps, 't1', 'd1', NOW)).toBe('verified_elsewhere');
  });

  it('lets any other write failure through', async () => {
    const { deps, domains } = setup(() => Promise.resolve([[CHALLENGE]]));
    domains.markVerified.mockRejectedValue(new Error('connection lost'));
    await expect(verifyDomain(deps, 't1', 'd1', NOW)).rejects.toThrow('connection lost');
  });
});
