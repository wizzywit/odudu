import { DomainConflictError, type DomainRow } from '#/repository/tenant-domains';
import { lookupTxtOutcome, type ResolveTxt } from '#/service/tenant-domain';

export interface VerifyDomainDomains {
  get(tenantId: string, id: string): Promise<DomainRow | null>;
  markVerified(tenantId: string, id: string, now: Date): Promise<DomainRow | null>;
  recordCheck(tenantId: string, id: string, passed: boolean, now: Date): Promise<DomainRow | null>;
}

export interface VerifyDomainDeps {
  resolveTxt: ResolveTxt;
  domains: VerifyDomainDomains;
}

export type VerifyDomainOutcome =
  'verified' | 'pending' | 'failed' | 'not_found' | 'verified_elsewhere';

export async function verifyDomain(
  deps: VerifyDomainDeps,
  tenantId: string,
  id: string,
  now: Date,
): Promise<VerifyDomainOutcome> {
  const row = await deps.domains.get(tenantId, id);
  if (row === null) return 'not_found';
  if (row.state === 'verified') return 'verified';
  const found = await lookupTxtOutcome(deps.resolveTxt, row.host, row.challenge);
  // A failed row stays failed until its record is seen again; the misses
  // that failed it are already counted.
  if (row.state === 'failed' && found !== 'match') return 'failed';
  if (found === 'indeterminate') return 'pending';
  if (found === 'absent') {
    await deps.domains.recordCheck(tenantId, id, false, now);
    return 'pending';
  }
  try {
    await deps.domains.markVerified(tenantId, id, now);
    return 'verified';
  } catch (error) {
    if (error instanceof DomainConflictError && error.reason === 'host_verified_elsewhere') {
      return 'verified_elsewhere';
    }
    throw error;
  }
}
