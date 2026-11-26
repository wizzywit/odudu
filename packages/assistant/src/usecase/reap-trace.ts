import { sql } from 'drizzle-orm';
import { retentionRepository } from '#/repository/retention';
import type { AssistantTx } from '#/repository/tx';
import { drain } from '#/service/drain';
import { UPKEEP_BATCH, UPKEEP_MAX_TARGETS } from '#/service/limits';
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
 * the next pass takes the rest. A conversation bound to another tenant ends by
 * the shorter of the two tenants' windows: `daysOfTenant` reads the other's.
 */
export async function reapTrace(
  tx: AssistantTx,
  now: Date,
  daysOfTenant: (tenantId: string) => Promise<number>,
): Promise<TraceReapReport> {
  // A row a live turn holds is waited for briefly and left to the next pass.
  await tx.execute(sql`set local lock_timeout = '2s'`);
  const repository = retentionRepository(tx);
  const homeDays = await repository.days();
  const before = retentionCutoff(now, homeDays);
  const sweep = async (cutoff: Date, target?: string): Promise<TraceReapReport> => ({
    turnsDeleted: await drain(
      () => repository.pruneTurns(cutoff, UPKEEP_BATCH, target),
      UPKEEP_BATCH,
    ),
    approvalCardsDeleted: await drain(
      () => repository.pruneCards(cutoff, UPKEEP_BATCH, target),
      UPKEEP_BATCH,
    ),
    conversationsDeleted: await drain(
      () => repository.pruneConversations(cutoff, UPKEEP_BATCH, target),
      UPKEEP_BATCH,
    ),
  });
  let total = await sweep(before);
  // Every bound target is visited, a page at a time, so nothing but one page
  // of ids is held however many tenants the conversations are bound to.
  let after: string | undefined;
  for (;;) {
    const page = await repository.targets(after, UPKEEP_MAX_TARGETS);
    for (const target of page) {
      const days = await daysOfTenant(target);
      if (days >= homeDays) continue;
      const done = await sweep(retentionCutoff(now, days), target);
      total = {
        turnsDeleted: total.turnsDeleted + done.turnsDeleted,
        approvalCardsDeleted: total.approvalCardsDeleted + done.approvalCardsDeleted,
        conversationsDeleted: total.conversationsDeleted + done.conversationsDeleted,
      };
    }
    if (page.length < UPKEEP_MAX_TARGETS) return total;
    after = page[page.length - 1];
  }
}

/** A tenant's days of trace, for the pass of a tenant whose conversations are bound to it. */
export async function traceRetentionDays(tx: AssistantTx): Promise<number> {
  return retentionRepository(tx).days();
}
