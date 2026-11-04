import { ACCESS_TOKEN_CEILING_SECONDS } from '@odudu/contracts/admin';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type DomainRow } from '#/repository/tenant-domains';
import { type ResolveTxt } from '#/service/tenant-domain';
import {
  recheckDomains,
  type RecheckDomainsDeps,
  type RecheckRow,
  type RecheckScope,
} from '#/usecase/recheck-domains';

const NOW = new Date('2026-11-04T12:00:00Z');
const CHALLENGE = 'odudu-domain-verification=abc';

interface Stored extends RecheckRow {
  state: DomainRow['state'];
}

function stored(n: number, over: Partial<Stored> = {}): Stored {
  return {
    id: `d${String(n).padStart(6, '0')}`,
    tenantId: `t${String(n).padStart(6, '0')}`,
    tenantName: `tenant${String(n)}`,
    host: `h${String(n).padStart(6, '0')}.acme.com`,
    challenge: CHALLENGE,
    failedChecks: 0,
    canonical: false,
    state: 'verified',
    ...over,
  };
}

const failing = (code: string) => () => Promise.reject(Object.assign(new Error(code), { code }));
const present: ResolveTxt = () => Promise.resolve([[CHALLENGE]]);
const absent: ResolveTxt = failing('ENOTFOUND');

function world(rows: Stored[], overrides: Partial<RecheckDomainsDeps> = {}) {
  const writes: string[] = [];
  const retirements: { tenantId: string; issuer: string; expiresAt: Date }[] = [];
  const audits: { tenantId: string; resourceId: string; detail: Record<string, unknown> }[] = [];
  const pageCalls: (string | undefined)[] = [];
  const byId = (id: string) => rows.find((r) => r.id === id);
  const asRow = (r: Stored): DomainRow => ({
    id: r.id,
    tenantId: r.tenantId,
    host: r.host,
    state: r.state,
    challenge: r.challenge,
    verifiedAt: NOW,
    lastCheckedAt: null,
    failedChecks: r.failedChecks,
    canonical: r.canonical,
  });
  const scope = (tenantId: string): RecheckScope => ({
    domains: {
      recordCheck: (_t, id, passed) => {
        writes.push(`${passed ? 'reset' : 'miss'}:${id}`);
        const r = byId(id);
        if (r === undefined) return Promise.resolve(null);
        r.failedChecks = passed ? 0 : r.failedChecks + 1;
        return Promise.resolve(asRow(r));
      },
      markFailed: (_t, id) => {
        writes.push(`failed:${id}`);
        const r = byId(id);
        if (r === undefined) return Promise.resolve(null);
        r.state = 'failed';
        r.canonical = false;
        return Promise.resolve(asRow(r));
      },
      canonical: (t) => {
        const r = rows.find((x) => x.tenantId === t && x.canonical);
        return Promise.resolve(r === undefined ? null : asRow(r));
      },
      lock: () => Promise.resolve(),
      get: (_t, id) => {
        const r = byId(id);
        return Promise.resolve(r === undefined ? null : asRow(r));
      },
      setCanonical: () => Promise.resolve(null),
      clearCanonical: (t) => {
        writes.push(`clear:${t}`);
        for (const r of rows) if (r.tenantId === t) r.canonical = false;
        return Promise.resolve(1);
      },
      retireIssuer: (t, issuer, expiresAt) => {
        retirements.push({ tenantId: t, issuer, expiresAt });
        return Promise.resolve();
      },
      clearRetirement: () => Promise.resolve(false),
    },
    audit: (event) => {
      audits.push({ tenantId, resourceId: event.resourceId, detail: event.detail });
      return Promise.resolve();
    },
  });
  const deps: RecheckDomainsDeps = {
    resolveTxt: present,
    domains: {
      page: (after, limit) => {
        pageCalls.push(after);
        return Promise.resolve(
          rows
            .filter((r) => r.state === 'verified' && (after === undefined || r.host > after))
            .sort((a, b) => (a.host < b.host ? -1 : 1))
            .slice(0, limit),
        );
      },
      inTenant: (tenantId, fn) => fn(scope(tenantId)),
    },
    timeoutMs: 1000,
    concurrency: 4,
    pageSize: 10,
    threshold: 3,
    base: 'https://id.operator.net',
    tls: true,
    ...overrides,
  };
  return { deps, writes, retirements, audits, pageCalls, rows };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('recheckDomains', () => {
  it('counts a healthy pass and performs no write', async () => {
    const w = world([stored(1), stored(2), stored(3)]);
    expect(await recheckDomains(w.deps, NOW)).toEqual({
      checked: 3,
      failed: 0,
      indeterminate: 0,
      fellBack: 0,
    });
    expect(w.writes).toEqual([]);
  });

  it('resets a failure count that was above zero on a match, and only then', async () => {
    const w = world([stored(1, { failedChecks: 2 }), stored(2)]);
    await recheckDomains(w.deps, NOW);
    expect(w.writes).toEqual(['reset:d000001']);
    expect(w.rows[0]?.failedChecks).toBe(0);
  });

  it('counts a missing record and fails the row at the threshold', async () => {
    const w = world([stored(1)], { resolveTxt: absent });
    expect(await recheckDomains(w.deps, NOW)).toMatchObject({ failed: 0 });
    expect(w.rows[0]?.failedChecks).toBe(1);
    await recheckDomains(w.deps, NOW);
    const third = await recheckDomains(w.deps, NOW);
    expect(third).toEqual({ checked: 1, failed: 1, indeterminate: 0, fellBack: 0 });
    expect(w.rows[0]?.state).toBe('failed');
    expect(w.audits).toEqual([
      {
        tenantId: 't000001',
        resourceId: 'd000001',
        detail: { host: 'h000001.acme.com', reason: 'ownership_lost' },
      },
    ]);
  });

  it('reads a record with another value as missing', async () => {
    const w = world([stored(1)], { resolveTxt: () => Promise.resolve([['other']]) });
    await recheckDomains(w.deps, NOW);
    expect(w.rows[0]?.failedChecks).toBe(1);
  });

  it('reads a failing resolver as unknown and counts nothing', async () => {
    const w = world([stored(1), stored(2, { failedChecks: 2 }), stored(3), stored(4)], {
      resolveTxt: (name) =>
        name.includes('h000001')
          ? failing('ESERVFAIL')()
          : name.includes('h000002')
            ? absent(name)
            : present(name),
    });
    const report = await recheckDomains(w.deps, NOW);
    expect(report).toMatchObject({ checked: 4, indeterminate: 1, failed: 1 });
    expect(w.rows.map((r) => r.failedChecks)).toEqual([0, 3, 0, 0]);
  });

  it('changes nothing in a page where more than half the lookups are unknown', async () => {
    const rows = [1, 2, 3, 4].map((n) => stored(n, { failedChecks: 2, canonical: n === 1 }));
    const w = world(rows, { resolveTxt: failing('ESERVFAIL') });
    expect(await recheckDomains(w.deps, NOW)).toEqual({
      checked: 4,
      failed: 0,
      indeterminate: 4,
      fellBack: 0,
    });
    expect(w.writes).toEqual([]);
    expect(w.rows.every((r) => r.failedChecks === 2 && r.state === 'verified')).toBe(true);
    expect(w.rows[0]?.canonical).toBe(true);
  });

  it('counts a timeout as unknown', async () => {
    vi.useFakeTimers();
    const w = world([stored(1), stored(2), stored(3)], {
      timeoutMs: 50,
      resolveTxt: (name) =>
        name.includes('h000001') ? new Promise(() => undefined) : present(name),
    });
    const pending = recheckDomains(w.deps, NOW);
    await vi.advanceTimersByTimeAsync(50);
    expect(await pending).toMatchObject({ checked: 3, indeterminate: 1 });
  });

  it('never runs more lookups at once than the limit', async () => {
    let live = 0;
    let peak = 0;
    const w = world(
      Array.from({ length: 30 }, (_v, n) => stored(n)),
      {
        pageSize: 30,
        concurrency: 5,
        resolveTxt: async () => {
          live += 1;
          peak = Math.max(peak, live);
          await new Promise((resolve) => setTimeout(resolve, 1));
          live -= 1;
          return [[CHALLENGE]];
        },
      },
    );
    await recheckDomains(w.deps, NOW);
    expect(peak).toBe(5);
  });

  it('walks 25,000 rows in pages, one page query each', async () => {
    const w = world(
      Array.from({ length: 25_000 }, (_v, n) => stored(n)),
      { pageSize: 500, concurrency: 64 },
    );
    const report = await recheckDomains(w.deps, NOW);
    expect(report.checked).toBe(25_000);
    expect(w.pageCalls).toHaveLength(51);
    expect(w.pageCalls[1]).toBe('h000499.acme.com');
    expect(w.writes).toEqual([]);
  });

  it('returns a tenant to its path address, retiring the domain issuer', async () => {
    const w = world([stored(1, { failedChecks: 2, canonical: true }), stored(2), stored(3)], {
      resolveTxt: (name) => (name.includes('h000001') ? absent(name) : present(name)),
    });
    const report = await recheckDomains(w.deps, NOW);
    expect(report).toMatchObject({ failed: 1, fellBack: 1 });
    expect(w.writes).toEqual(['miss:d000001', 'clear:t000001', 'failed:d000001']);
    expect(w.retirements).toEqual([
      {
        tenantId: 't000001',
        issuer: 'https://h000001.acme.com',
        expiresAt: new Date(NOW.getTime() + ACCESS_TOKEN_CEILING_SECONDS * 1000),
      },
    ]);
    expect(w.audits[0]?.detail).toMatchObject({ reason: 'ownership_lost', fell_back: true });
  });

  it('fails a domain that is not canonical without switching anything', async () => {
    const w = world([stored(1, { failedChecks: 2 })], { resolveTxt: absent });
    const report = await recheckDomains(w.deps, NOW);
    expect(report).toMatchObject({ failed: 1, fellBack: 0 });
    expect(w.retirements).toEqual([]);
    expect(w.writes).toEqual(['miss:d000001', 'failed:d000001']);
  });

  it('skips a row removed between the read and the write', async () => {
    const w = world([stored(1), stored(2)], { resolveTxt: absent });
    const page = w.deps.domains.page.bind(w.deps.domains);
    w.deps.domains.page = async (after, limit) => {
      const found = await page(after, limit);
      w.rows.splice(0, 1);
      return found;
    };
    const report = await recheckDomains(w.deps, NOW);
    expect(report).toMatchObject({ checked: 2, failed: 0 });
    expect(w.rows[0]?.failedChecks).toBe(1);
  });

  it('survives a resolver that throws on one domain', async () => {
    const w = world([stored(1), stored(2)], {
      resolveTxt: (name) => {
        if (name.includes('h000001')) throw new Error('boom');
        return absent(name);
      },
    });
    const report = await recheckDomains(w.deps, NOW);
    expect(report).toMatchObject({ checked: 2, indeterminate: 1 });
    expect(w.rows[1]?.failedChecks).toBe(1);
  });
});
