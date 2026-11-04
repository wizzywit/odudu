import { type DomainRow, type VerifiedDomainRow } from '#/repository/tenant-domains';
import { lookupTxtOutcome, type ResolveTxt, type TxtOutcome } from '#/service/tenant-domain';
import { switchCanonical, type SwitchDomains } from '#/usecase/switch-canonical';

export interface RecheckAuditEvent {
  action: 'domain.failed';
  resourceId: string;
  detail: Record<string, unknown>;
}

// What a write inside one tenant's transaction can reach.
export interface RecheckScope {
  domains: SwitchDomains & {
    recordCheck(
      tenantId: string,
      id: string,
      passed: boolean,
      now: Date,
    ): Promise<DomainRow | null>;
    markFailed(tenantId: string, id: string): Promise<DomainRow | null>;
  };
  audit(event: RecheckAuditEvent): Promise<void>;
}

export interface RecheckDomainsDeps {
  resolveTxt: ResolveTxt;
  domains: {
    // Verified rows of every tenant, in host order after `after`: read where no
    // tenant context limits it.
    page(after: string | undefined, limit: number): Promise<VerifiedDomainRow[]>;
    inTenant<T>(tenantId: string, fn: (scope: RecheckScope) => Promise<T>): Promise<T>;
  };
  timeoutMs: number;
  concurrency: number;
  pageSize: number;
  // Consecutive passes without the record that fail a domain.
  threshold: number;
  base: string;
  tls: boolean;
  // Told of a row whose write failed, before the pass moves on to the next.
  onRowError?: (row: VerifiedDomainRow, error: unknown) => void;
}

export interface RecheckReport {
  checked: number;
  failed: number;
  indeterminate: number;
  fellBack: number;
  errored: number;
}

interface Looked {
  row: VerifiedDomainRow;
  outcome: TxtOutcome;
}

function cutAt<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error('DNS lookup timed out'));
    }, timeoutMs);
  });
  return Promise.race([work, expired]).finally(() => {
    clearTimeout(timer);
  });
}

async function lookupAll(
  deps: RecheckDomainsDeps,
  rows: readonly VerifiedDomainRow[],
): Promise<Looked[]> {
  const looked: Looked[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let index = next++; index < rows.length; index = next++) {
      const row = rows[index];
      if (row === undefined) return;
      let outcome: TxtOutcome;
      try {
        outcome = await cutAt(
          lookupTxtOutcome(deps.resolveTxt, row.host, row.challenge),
          deps.timeoutMs,
        );
      } catch {
        outcome = 'indeterminate';
      }
      looked.push({ row, outcome });
    }
  };
  await Promise.all(Array.from({ length: Math.min(deps.concurrency, rows.length) }, worker));
  return looked;
}

// Fails the row once the miss just counted reaches the threshold, and when it
// was the tenant's address puts the tenant back on its path address first, in
// the same transaction, the way an admin's deactivation writes it.
async function countMiss(
  deps: RecheckDomainsDeps,
  scope: RecheckScope,
  row: VerifiedDomainRow,
  now: Date,
): Promise<{ failed: boolean; fellBack: boolean }> {
  const counted = await scope.domains.recordCheck(row.tenantId, row.id, false, now);
  if (counted?.state !== 'verified' || counted.failedChecks < deps.threshold) {
    return { failed: false, fellBack: false };
  }
  let fellBack = false;
  if (counted.canonical) {
    const outcome = await switchCanonical(
      { domains: scope.domains, base: deps.base, tls: deps.tls },
      { id: row.tenantId, name: row.tenantName },
      'path',
      now,
      { precondition: (current) => current?.id === row.id },
    );
    // A switch that was overtaken or could not be written leaves the row
    // verified at the threshold, so the next pass tries again. One that finds
    // the tenant already moved off this domain only has the row to fail.
    const moved = ['switched', 'unchanged', 'precondition_failed'].includes(outcome.kind);
    if (!moved) return { failed: false, fellBack: false };
    fellBack = outcome.kind === 'switched';
  }
  await scope.domains.markFailed(row.tenantId, row.id);
  await scope.audit({
    action: 'domain.failed',
    resourceId: row.id,
    detail: { host: row.host, reason: 'ownership_lost', ...(fellBack ? { fell_back: true } : {}) },
  });
  return { failed: true, fellBack };
}

async function settle(
  deps: RecheckDomainsDeps,
  { row, outcome }: Looked,
  now: Date,
): Promise<{ failed: boolean; fellBack: boolean }> {
  if (outcome === 'match') {
    if (row.failedChecks > 0) {
      await deps.domains.inTenant(row.tenantId, (scope) =>
        scope.domains.recordCheck(row.tenantId, row.id, true, now),
      );
    }
    return { failed: false, fellBack: false };
  }
  return deps.domains.inTenant(row.tenantId, (scope) => countMiss(deps, scope, row, now));
}

// One walk over every verified domain, a page at a time: each page is one
// read, its lookups run `concurrency` at a time, and the writes it earns are
// only those a changed row needs, so a healthy pass writes nothing. A page in
// which more than half the lookups could not be answered changes nothing, so
// a resolver outage cannot fail the domains it covers.
export async function recheckDomains(deps: RecheckDomainsDeps, now: Date): Promise<RecheckReport> {
  const report: RecheckReport = {
    checked: 0,
    failed: 0,
    indeterminate: 0,
    fellBack: 0,
    errored: 0,
  };
  let after: string | undefined;
  for (;;) {
    const rows = await deps.domains.page(after, deps.pageSize);
    const last = rows[rows.length - 1];
    if (last === undefined) return report;
    const looked = await lookupAll(deps, rows);
    const unknown = looked.filter((l) => l.outcome === 'indeterminate').length;
    report.checked += rows.length;
    report.indeterminate += unknown;
    if (unknown * 2 <= rows.length) {
      for (const result of looked) {
        if (result.outcome === 'indeterminate') continue;
        try {
          const done = await settle(deps, result, now);
          if (done.failed) report.failed += 1;
          if (done.fellBack) report.fellBack += 1;
        } catch (error) {
          report.errored += 1;
          deps.onRowError?.(result.row, error);
        }
      }
    }
    if (rows.length < deps.pageSize) return report;
    after = last.host;
  }
}
