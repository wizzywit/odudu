import { liveSessionCondition, sessions } from '@odudu/authn-flows';
import { tenants, type TenantScopedDatabase } from '@odudu/db';
import { endSession as endOidcSession } from '@odudu/protocol-oidc';
import { asc, eq, type SQL } from 'drizzle-orm';
import { countAtMost } from '#/usecase/capped-count';

// Each through the one `endSession` a single end makes, locked in id order.
export async function endSessionsWhere(
  tx: TenantScopedDatabase,
  kek: Uint8Array,
  input: { readonly tenantId: string; readonly now: Date; readonly issuer: string },
  where: SQL | undefined,
  limit: number | null,
): Promise<number> {
  const selected = tx
    .select({ id: sessions.id, subjectId: sessions.subjectId })
    .from(sessions)
    .where(where)
    .orderBy(asc(sessions.id));
  const targets = await (limit === null ? selected : selected.limit(limit)).for('update');
  for (const target of targets) {
    await endOidcSession(
      tx,
      { kek },
      {
        tenantId: input.tenantId,
        sessionId: target.id,
        subjectId: target.subjectId,
        now: input.now,
        issuer: input.issuer,
        via: 'admin',
      },
    );
  }
  return targets.length;
}

/** How many sessions one transaction ends; the rest wait for the next. */
export const TENANT_SESSIONS_END_LIMIT = 500;

export interface BatchOutcome {
  readonly ended: number;
  readonly remaining: number;
}

export interface DisabledTenantSessionsAuditEvent {
  readonly action: 'session.end_all';
  readonly resourceType: 'tenant';
  readonly resourceId: string;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
  readonly outcome: 'allowed';
  readonly detail: Record<string, unknown>;
}

export interface EndDisabledTenantSessionsDeps {
  readonly kek: Uint8Array;
  readonly audit: (
    tx: TenantScopedDatabase,
    event: DisabledTenantSessionsAuditEvent,
  ) => Promise<void>;
}

export interface EndDisabledTenantSessionsInput {
  readonly tenantId: string;
  readonly now: Date;
  readonly issuer: string;
  readonly actorSubjectId: string;
  readonly actorTenantId: string;
  readonly actorClientId: string;
}

/**
 * One batch of a disabled tenant's live sessions, each ended with its
 * Back-Channel Logout Tokens queued. Held to no ceiling (ADR 0040's
 * amendment of 2026-09-30): the disable already shuts every subject out.
 * Ends nothing once the tenant is enabled again.
 */
export async function endDisabledTenantSessions(
  tx: TenantScopedDatabase,
  deps: EndDisabledTenantSessionsDeps,
  input: EndDisabledTenantSessionsInput,
): Promise<BatchOutcome> {
  const rows = await tx
    .select({
      enabled: tenants.enabled,
      ssoSessionIdleSeconds: tenants.ssoSessionIdleSeconds,
      ssoSessionMaxSeconds: tenants.ssoSessionMaxSeconds,
      rememberMeIdleSeconds: tenants.rememberMeIdleSeconds,
      rememberMeMaxSeconds: tenants.rememberMeMaxSeconds,
    })
    .from(tenants)
    .where(eq(tenants.id, input.tenantId))
    .for('share');
  const tenant = rows[0];
  if (tenant === undefined || tenant.enabled) return { ended: 0, remaining: 0 };

  const live = liveSessionCondition(tenant, input.now);
  const ended = await endSessionsWhere(tx, deps.kek, input, live, TENANT_SESSIONS_END_LIMIT);
  const remaining = await countAtMost(tx, { table: sessions, where: live });
  if (ended > 0) {
    await deps.audit(tx, {
      action: 'session.end_all',
      resourceType: 'tenant',
      resourceId: input.tenantId,
      actorSubjectId: input.actorSubjectId,
      actorTenantId: input.actorTenantId,
      actorClientId: input.actorClientId,
      outcome: 'allowed',
      detail: { ended, remaining, via: 'tenant_disabled' },
    });
  }
  return { ended, remaining };
}

/**
 * Runs `batch`, each call its own transaction, until nothing remains or a
 * batch ends nothing. A failing batch is handed back rather than thrown, with
 * what the batches before it ended, so the caller can say the disable
 * committed while its sessions did not all end.
 */
export async function inBatches(
  batch: () => Promise<BatchOutcome>,
): Promise<{ ended: number; remaining: number | null; failure?: unknown }> {
  let ended = 0;
  let remaining: number | null = null;
  for (;;) {
    let outcome: BatchOutcome;
    try {
      outcome = await batch();
    } catch (failure) {
      return { ended, remaining, failure };
    }
    ended += outcome.ended;
    remaining = outcome.remaining;
    if (remaining === 0 || outcome.ended === 0) return { ended, remaining };
  }
}
