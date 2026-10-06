import { type TenantScopedDatabase } from '@odudu/db';
import { loginFailures } from '@odudu/domain-identity';
import { asc, sql } from 'drizzle-orm';
import { BULK_WRITE_LIMIT } from '#/usecase/bulk-limit';
import { countAtMost } from '#/usecase/capped-count';
import { isBeyond, isNotBeyond, subjectsBeyond } from '#/service/capability-ceiling';

export interface LockoutsAuditEvent {
  readonly action: 'subject.lockouts_clear';
  readonly resourceType: 'tenant';
  readonly resourceId: string;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
  readonly outcome: 'allowed';
  readonly detail: Record<string, unknown>;
}

/** The most subject ids a tenant-wide clear's audit row names. */
export const AUDITED_SUBJECT_IDS = 100;

/** How many lockouts one clear removes; the rest wait for the next. */
export const LOCKOUTS_CLEAR_LIMIT = BULK_WRITE_LIMIT;

export interface ClearLockoutsInput {
  readonly tenantId: string;
  /** The most it clears in this call: `LOCKOUTS_CLEAR_LIMIT` unless a test says less. */
  readonly limit?: number;
  readonly callerCapabilities: ReadonlySet<string>;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

// What `DELETE …/subjects/{id}/lockout` does to one subject, done to every
// subject with a run of failures against it, locked or still counting.
// A subject holding an admin capability the caller does not keeps its row
// and is counted instead (ADR 0040), as the single door refuses it. The row
// names whose counts went, as far as `AUDITED_SUBJECT_IDS` of them, so the
// single door's per-subject trail is not lost to the tenant-wide one.
export async function clearLockouts(
  tx: TenantScopedDatabase,
  deps: { readonly audit: (tx: TenantScopedDatabase, event: LockoutsAuditEvent) => Promise<void> },
  input: ClearLockoutsInput,
): Promise<{ cleared: number; beyondCeiling: number; remaining: number }> {
  const beyond = subjectsBeyond(input.callerCapabilities);
  const reachable = beyond === null ? undefined : isNotBeyond(loginFailures.subjectId, beyond);
  const batch = tx
    .select({ subjectId: loginFailures.subjectId })
    .from(loginFailures)
    .where(reachable)
    .orderBy(asc(loginFailures.subjectId))
    .limit(input.limit ?? LOCKOUTS_CLEAR_LIMIT);
  const cleared = await tx
    .delete(loginFailures)
    .where(sql`${loginFailures.subjectId} = ANY(ARRAY(${batch}))`)
    .returning({ subjectId: loginFailures.subjectId });
  const remaining = await countAtMost(tx, {
    table: loginFailures,
    where: reachable,
  });
  const beyondCeiling =
    beyond === null
      ? 0
      : await countAtMost(tx, {
          table: loginFailures,
          where: isBeyond(loginFailures.subjectId, beyond),
        });

  await deps.audit(tx, {
    action: 'subject.lockouts_clear',
    resourceType: 'tenant',
    resourceId: input.tenantId,
    actorSubjectId: input.actorSubjectId,
    actorTenantId: input.actorTenantId,
    actorClientId: input.actorClientId,
    outcome: 'allowed',
    detail: {
      cleared: cleared.length,
      beyond_ceiling: beyondCeiling,
      subject_ids: cleared
        .map((row) => row.subjectId)
        .sort()
        .slice(0, AUDITED_SUBJECT_IDS),
    },
  });
  return { cleared: cleared.length, beyondCeiling, remaining };
}
