import { type TenantScopedDatabase } from '@odudu/db';
import { loginFailures } from '@odudu/domain-identity';
import { count, inArray, not } from 'drizzle-orm';
import { subjectsBeyond } from '#/service/capability-ceiling';

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

export interface ClearLockoutsInput {
  readonly tenantId: string;
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
): Promise<{ cleared: number; beyondCeiling: number }> {
  const beyond = subjectsBeyond(input.callerCapabilities);
  const cleared = await tx
    .delete(loginFailures)
    .where(beyond === null ? undefined : not(inArray(loginFailures.subjectId, beyond)))
    .returning({ subjectId: loginFailures.subjectId });
  const beyondCeiling =
    beyond === null
      ? 0
      : ((
          await tx
            .select({ n: count() })
            .from(loginFailures)
            .where(inArray(loginFailures.subjectId, beyond))
        )[0]?.n ?? 0);

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
  return { cleared: cleared.length, beyondCeiling };
}
