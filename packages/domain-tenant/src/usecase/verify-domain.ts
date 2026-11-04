import { DomainConflictError, type DomainRow } from '#/repository/tenant-domains';
import { challengeName, txtMatchesChallenge } from '#/service/tenant-domain';

export type ResolveTxt = (name: string) => Promise<readonly (readonly string[])[]>;

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

// What a resolver says when the name or the record is not there; any other
// error is a resolver that could not answer, which proves nothing either way.
const ABSENT_CODES = new Set(['ENOTFOUND', 'ENODATA']);

function isAbsent(error: unknown): boolean {
  return error instanceof Error && 'code' in error && ABSENT_CODES.has(String(error.code));
}

type Lookup = 'match' | 'absent' | 'indeterminate';

async function lookup(resolveTxt: ResolveTxt, row: DomainRow): Promise<Lookup> {
  try {
    const records = await resolveTxt(challengeName(row.host));
    return txtMatchesChallenge(records, row.challenge) ? 'match' : 'absent';
  } catch (error) {
    return isAbsent(error) ? 'absent' : 'indeterminate';
  }
}

export async function verifyDomain(
  deps: VerifyDomainDeps,
  tenantId: string,
  id: string,
  now: Date,
): Promise<VerifyDomainOutcome> {
  const row = await deps.domains.get(tenantId, id);
  if (row === null) return 'not_found';
  if (row.state === 'verified') return 'verified';
  if (row.state === 'failed') return 'failed';
  const found = await lookup(deps.resolveTxt, row);
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
