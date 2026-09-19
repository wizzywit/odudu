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
  maxSessionsPerBrowser: number;
  lifespans: SessionLifespans;
}

// The only place a session row is created (ADR 0033). Locks the realm's
// own row before reading anything else: `SELECT ... FOR UPDATE` on the
// session rows re-qualifies only the rows its original scan already
// found and never sees a row a concurrent admission inserted while it
// waited, so it does not hold the cap (ADR 0033's worked failure and
// reproduction). The realm-row lock forces a second, concurrent
// admission's own session read, once unblocked, to be a fresh statement
// under a fresh snapshot that finds what the first one committed.
export async function admitSession(
  tx: RealmScopedDatabase,
  input: AdmitSessionInput,
  clock: Clock = systemClock,
): Promise<{ sessionId: string }> {
  await tx.select().from(realms).where(eq(realms.id, input.realmId)).for('update');

  const now = clock.now();
  const repo = sessionRepository(tx);
  const live = await repo.liveBySubject(input.subjectId, input.lifespans, now);
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
