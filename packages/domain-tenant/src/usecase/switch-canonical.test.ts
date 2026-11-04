import { ACCESS_TOKEN_CEILING_SECONDS } from '@odudu/contracts/admin';
import { describe, expect, it, vi } from 'vitest';
import { CanonicalConflictError, type DomainRow } from '#/repository/tenant-domains';
import {
  switchCanonical,
  type SwitchCanonicalDeps,
  type SwitchDomains,
} from '#/usecase/switch-canonical';

const NOW = new Date('2026-11-04T12:00:00Z');
const acme = { id: 'tenant-1', name: 'acme' };

function row(id: string, host: string, over: Partial<DomainRow> = {}): DomainRow {
  return {
    id,
    tenantId: acme.id,
    host,
    state: 'verified',
    challenge: 'c',
    verifiedAt: NOW,
    lastCheckedAt: NOW,
    failedChecks: 0,
    canonical: false,
    ...over,
  };
}

function setup(rows: DomainRow[], canonical: (string | null)[] = []) {
  const calls: string[] = [];
  const reads = [...canonical];
  const spies = {
    canonical: vi.fn<SwitchDomains['canonical']>(() => {
      calls.push('canonical');
      const next = reads.length > 1 ? reads.shift() : reads[0];
      return Promise.resolve(rows.find((r) => r.id === next) ?? null);
    }),
    lock: vi.fn<SwitchDomains['lock']>(() => {
      calls.push('lock');
      return Promise.resolve();
    }),
    get: vi.fn<SwitchDomains['get']>((_tenantId, id) =>
      Promise.resolve(rows.find((r) => r.id === id) ?? null),
    ),
    setCanonical: vi.fn<SwitchDomains['setCanonical']>((_tenantId, id) => {
      calls.push(`set:${id}`);
      return Promise.resolve(rows.find((r) => r.id === id) ?? null);
    }),
    clearCanonical: vi.fn<SwitchDomains['clearCanonical']>(() => {
      calls.push('clear');
      return Promise.resolve(1);
    }),
    retireIssuer: vi.fn<SwitchDomains['retireIssuer']>(() => Promise.resolve()),
    clearRetirement: vi.fn<SwitchDomains['clearRetirement']>(() => Promise.resolve(true)),
  };
  const domains: SwitchDomains = { ...spies };
  const deps: SwitchCanonicalDeps = { domains, base: 'https://id.operator.net', tls: true };
  return { deps, domains: spies, calls };
}

const ceiling = new Date(NOW.getTime() + ACCESS_TOKEN_CEILING_SECONDS * 1000);

describe('switchCanonical', () => {
  it('retires the path issuer and clears the new domain’s retirement on the first switch', async () => {
    const a = row('a', 'login.acme.com');
    const { deps, domains } = setup([a], [null]);
    const out = await switchCanonical(deps, acme, 'a', NOW);
    expect(out.kind).toBe('switched');
    expect(domains.setCanonical).toHaveBeenCalledWith('tenant-1', 'a');
    expect(domains.retireIssuer).toHaveBeenCalledWith(
      'tenant-1',
      'https://id.operator.net/tenants/acme',
      ceiling,
    );
    expect(domains.clearRetirement).toHaveBeenCalledWith('tenant-1', 'https://login.acme.com');
  });

  it('retires a domain’s issuer in the scheme the server serves it over', async () => {
    const a = row('a', 'login.acme.com', { canonical: true });
    const { deps, domains } = setup([a], ['a']);
    const plain = { ...deps, base: 'http://id.operator.net', tls: false };
    await switchCanonical(plain, acme, 'path', NOW);
    expect(domains.clearCanonical).toHaveBeenCalledWith('tenant-1');
    expect(domains.retireIssuer).toHaveBeenCalledWith('tenant-1', 'http://login.acme.com', ceiling);
    expect(domains.clearRetirement).toHaveBeenCalledWith(
      'tenant-1',
      'http://id.operator.net/tenants/acme',
    );
  });

  it('switches from one domain to another, retiring the first', async () => {
    const a = row('a', 'a.acme.com', { canonical: true });
    const b = row('b', 'b.acme.com');
    const { deps, domains } = setup([a, b], ['a']);
    const out = await switchCanonical(deps, acme, 'b', NOW);
    expect(out).toMatchObject({ kind: 'switched', previous: { id: 'a' } });
    expect(domains.retireIssuer).toHaveBeenCalledWith('tenant-1', 'https://a.acme.com', ceiling);
    expect(domains.clearRetirement).toHaveBeenCalledWith('tenant-1', 'https://b.acme.com');
  });

  it('is unchanged, and writes nothing, when the target is already canonical', async () => {
    const a = row('a', 'a.acme.com', { canonical: true });
    const { deps, domains } = setup([a], ['a']);
    expect((await switchCanonical(deps, acme, 'a', NOW)).kind).toBe('unchanged');
    expect(domains.retireIssuer).not.toHaveBeenCalled();
    expect(domains.setCanonical).not.toHaveBeenCalled();
  });

  it('is unchanged when going to the path address from the path address', async () => {
    const { deps, domains } = setup([], [null]);
    expect((await switchCanonical(deps, acme, 'path', NOW)).kind).toBe('unchanged');
    expect(domains.retireIssuer).not.toHaveBeenCalled();
    expect(domains.clearCanonical).not.toHaveBeenCalled();
  });

  it('refuses a pending or failed domain and an unknown id', async () => {
    const p = row('p', 'p.acme.com', { state: 'pending' });
    const f = row('f', 'f.acme.com', { state: 'failed' });
    const { deps, domains } = setup([p, f], [null]);
    expect(await switchCanonical(deps, acme, 'p', NOW)).toEqual({
      kind: 'not_verified',
      state: 'pending',
    });
    expect(await switchCanonical(deps, acme, 'f', NOW)).toEqual({
      kind: 'not_verified',
      state: 'failed',
    });
    expect(await switchCanonical(deps, acme, 'nope', NOW)).toEqual({ kind: 'not_found' });
    expect(domains.setCanonical).not.toHaveBeenCalled();
    expect(domains.retireIssuer).not.toHaveBeenCalled();
  });

  it('refuses with no public base URL, which no domain can exist without', async () => {
    const a = row('a', 'a.acme.com');
    const { deps, domains } = setup([a], [null]);
    expect(await switchCanonical({ ...deps, base: undefined }, acme, 'a', NOW)).toEqual({
      kind: 'no_base_url',
    });
    expect(domains.lock).not.toHaveBeenCalled();
  });

  it('takes the tenant lock before it decides, and reports a switch that landed meanwhile', async () => {
    const a = row('a', 'a.acme.com');
    const b = row('b', 'b.acme.com');
    // First read, before the lock, sees no canonical; the read after it sees `a`.
    const { deps, domains, calls } = setup([a, b], [null, 'a']);
    expect(await switchCanonical(deps, acme, 'b', NOW)).toEqual({ kind: 'conflict' });
    expect(calls).toEqual(['canonical', 'lock', 'canonical']);
    expect(domains.retireIssuer).not.toHaveBeenCalled();
  });

  it('answers a failed precondition against the canonical read after the lock', async () => {
    const a = row('a', 'a.acme.com', { canonical: true });
    const b = row('b', 'b.acme.com');
    const { deps, domains } = setup([a, b], ['a']);
    const seen: (string | null)[] = [];
    const out = await switchCanonical(deps, acme, 'b', NOW, {
      precondition: (current) => {
        seen.push(current?.id ?? null);
        return false;
      },
    });
    expect(out).toEqual({ kind: 'precondition_failed' });
    expect(seen).toEqual(['a']);
    expect(domains.setCanonical).not.toHaveBeenCalled();
  });

  it('reports the index’s refusal of a second canonical as a conflict', async () => {
    const a = row('a', 'a.acme.com');
    const { deps, domains } = setup([a], [null]);
    vi.mocked(domains.setCanonical).mockRejectedValueOnce(new CanonicalConflictError('tenant-1'));
    expect(await switchCanonical(deps, acme, 'a', NOW)).toEqual({ kind: 'conflict' });
    expect(domains.retireIssuer).not.toHaveBeenCalled();
  });
});
