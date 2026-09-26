import { eq } from 'drizzle-orm';
import { tenants, type TenantScopedDatabase } from '@odudu/db';
import { auditRepository, type AuditEventInput } from '@odudu/domain-audit';
import { type Clock, systemClock } from '@odudu/kernel';
import { sessionRepository } from '#/repository/sessions';
import { type SessionEntry } from '#/service/session-entry';
import { lifespanFor, type SessionLifespans } from '#/service/session-lifespan';
import { chooseEvictions } from '#/service/session-set';
import { establishSession, type EstablishedSession } from '#/usecase/executor';

export interface AdmitSessionInput {
  tenantId: string;
  subjectId: string;
  authenticators: readonly string[];
  remembered: boolean;
  // The entries this browser's cookies present (both lists together),
  // re-verified under the lock, so an entry with a wrong secret is never
  // counted. The cap this bounds is `max_sessions_per_browser`, not a
  // per-subject count: a browser can hold sessions for more than one
  // subject (what `prompt=select_account` chooses among), and evicting by
  // subject would let each one carry the cap on its own, unbounded in total.
  browserSessions: readonly SessionEntry[];
  maxSessionsPerBrowser: number;
  lifespans: SessionLifespans;
}

// The only place a session row is created (ADR 0033). Locks the tenant's
// own row before reading anything else: a lock on the session rows
// instead does not hold the cap under concurrency (ADR 0033's worked
// failure). Locking the tenant row does not make eviction against a fixed
// id list exact either — see the ADR's amendment for the accepted
// cap+k residual and why a per-subject predicate is not the fix.
// `no key update` still excludes another admission, but not the key-share
// lock any row referencing the tenant holds: that wait can deadlock.
export async function admitSession(
  tx: TenantScopedDatabase,
  input: AdmitSessionInput,
  clock: Clock = systemClock,
): Promise<EstablishedSession> {
  await tx.select().from(tenants).where(eq(tenants.id, input.tenantId)).for('no key update');

  const now = clock.now();
  const repo = sessionRepository(tx);
  const live = await repo.liveByEntries(input.browserSessions, input.lifespans, now);
  const evicted = new Set(chooseEvictions(live, input.maxSessionsPerBrowser));
  await repo.endMany([...evicted], now);
  await auditRepository(tx).recordAll(
    live
      .filter((session) => evicted.has(session.id))
      .map((session): AuditEventInput => ({
        eventType: 'session',
        action: 'session.ended',
        outcome: 'allowed',
        actorSubjectId: session.subjectId,
        resourceType: 'session',
        resourceId: session.id,
        detail: { via: 'evicted' },
      })),
  );

  const { maxSeconds } = lifespanFor(input.lifespans, input.remembered);
  return establishSession(
    tx,
    input.tenantId,
    input.subjectId,
    maxSeconds,
    input.authenticators,
    input.remembered,
    clock,
  );
}
