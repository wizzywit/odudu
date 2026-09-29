import { liveSessionCondition, sessions } from '@odudu/authn-flows';
import { tenants, type TenantScopedDatabase } from '@odudu/db';
import { endSession as endOidcSession } from '@odudu/protocol-oidc';
import { asc, eq, type SQL } from 'drizzle-orm';

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

/**
 * Every live session of a tenant being disabled, ended with its Back-Channel
 * Logout Tokens queued, so no relying party is left signed in to a tenant
 * that answers nothing. Neither capped nor held to a ceiling: disabling
 * already shuts every subject out, and a disable that left some sessions
 * running with no one told would be worse than a long transaction.
 */
export async function endSessionsOfDisabledTenant(
  tx: TenantScopedDatabase,
  deps: { readonly kek: Uint8Array },
  input: { readonly tenantId: string; readonly now: Date; readonly issuer: string },
): Promise<number> {
  const rows = await tx
    .select({
      ssoSessionIdleSeconds: tenants.ssoSessionIdleSeconds,
      ssoSessionMaxSeconds: tenants.ssoSessionMaxSeconds,
      rememberMeIdleSeconds: tenants.rememberMeIdleSeconds,
      rememberMeMaxSeconds: tenants.rememberMeMaxSeconds,
    })
    .from(tenants)
    .where(eq(tenants.id, input.tenantId));
  const lifespans = rows[0];
  if (lifespans === undefined) return 0;
  return endSessionsWhere(tx, deps.kek, input, liveSessionCondition(lifespans, input.now), null);
}
