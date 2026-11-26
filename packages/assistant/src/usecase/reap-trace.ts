import { sql } from 'drizzle-orm';
import { retentionRepository } from '#/repository/retention';
import type { AssistantTx } from '#/repository/tx';
import { drain } from '#/service/drain';
import { UPKEEP_BATCH } from '#/service/limits';
import { retentionCutoff } from '#/service/retention';

export interface TraceReapReport {
  readonly turnsDeleted: number;
  readonly approvalCardsDeleted: number;
  readonly conversationsDeleted: number;
}

/**
 * Applies the tenant's trace retention to the tenant `tx` is bound to, taking
 * `now` as an argument so a test can place it. Turns older than the window go
 * with their steps and events, approval cards older than it go, and
 * conversations idle for longer go with their messages. A conversation a person
 * reported keeps all of it. Each kind is taken in rounds of a fixed size, a
 * fixed number of times, so a tenant with a backlog costs a bounded amount and
 * the next pass takes the rest.
 */
export async function reapTrace(tx: AssistantTx, now: Date): Promise<TraceReapReport> {
  // A row a live turn holds is waited for briefly and left to the next pass.
  await tx.execute(sql`set local lock_timeout = '2s'`);
  const repository = retentionRepository(tx);
  const before = retentionCutoff(now, await repository.days());
  const turnsDeleted = await drain(() => repository.pruneTurns(before, UPKEEP_BATCH), UPKEEP_BATCH);
  const approvalCardsDeleted = await drain(
    () => repository.pruneCards(before, UPKEEP_BATCH),
    UPKEEP_BATCH,
  );
  const conversationsDeleted = await drain(
    () => repository.pruneConversations(before, UPKEEP_BATCH),
    UPKEEP_BATCH,
  );
  return { turnsDeleted, approvalCardsDeleted, conversationsDeleted };
}
