import { eq } from 'drizzle-orm';
import { realms, type RealmScopedDatabase } from '@odudu/db';
import { type Clock, systemClock } from '@odudu/kernel';
import { sessionRepository } from '#/repository/sessions';
import { lifespanFor, type SessionLifespans } from '#/service/session-lifespan';
import { chooseEvictions } from '#/service/session-set';
import { establishSession } from '#/usecase/executor';

export interface AdmitSessionInput {
  realmId: string;
  subjectId: string;
  authenticators: readonly string[];
  remembered: boolean;
  // The ids this browser's cookies already name (both lists together,
  // resolveSessions's own live read — see login-submission.ts) — the cap
  // this bounds is `max_sessions_per_browser`, not a per-subject count: a
  // browser can hold sessions for more than one subject (what
  // `prompt=select_account` will choose among), and evicting by subject
  // would let each one carry the cap on its own, unbounded in total.
  browserSessionIds: readonly string[];
  maxSessionsPerBrowser: number;
  lifespans: SessionLifespans;
}

// The only place a session row is created (ADR 0033). Locks the realm's
// own row before reading anything else: a lock on the session rows
// instead does not hold the cap under concurrency (ADR 0033's worked
// failure). Locking the realm row does not make eviction against a fixed
// id list exact either — see the ADR's amendment for the accepted
// cap+k residual and why a per-subject predicate is not the fix.
export async function admitSession(
  tx: RealmScopedDatabase,
  input: AdmitSessionInput,
  clock: Clock = systemClock,
): Promise<{ sessionId: string }> {
  await tx.select().from(realms).where(eq(realms.id, input.realmId)).for('update');

  const now = clock.now();
  const repo = sessionRepository(tx);
  const live = await repo.liveByIds(input.browserSessionIds, input.lifespans, now);
  await repo.endMany(chooseEvictions(live, input.maxSessionsPerBrowser), now);

  const { maxSeconds } = lifespanFor(input.lifespans, input.remembered);
  return establishSession(
    tx,
    input.realmId,
    input.subjectId,
    maxSeconds,
    input.authenticators,
    input.remembered,
    clock,
  );
}
