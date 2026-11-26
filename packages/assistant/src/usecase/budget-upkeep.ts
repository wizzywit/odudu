import { sql } from 'drizzle-orm';
import { MAX_LIMIT } from '@odudu/contracts/admin';
import { budgetRepository } from '#/repository/budgets';
import { leaseRepository } from '#/repository/leases';
import type { AssistantTx } from '#/repository/tx';
import { drain } from '#/service/drain';
import { RESERVATION_SWEEP_AFTER_MS, UPKEEP_BATCH, upkeepCutoffs } from '#/service/limits';

export interface BudgetUpkeepReport {
  /** Open reservations whose call never reached the provider, given back. */
  readonly reservationsReleased: number;
  /** Open reservations whose call was sent, counted in full because their cost is unknown. */
  readonly reservationsCharged: number;
  readonly reservationsDeleted: number;
  readonly countersDeleted: number;
  readonly leasesDeleted: number;
}

/**
 * The assistant's budget upkeep for the tenant `tx` is bound to, taking `now`
 * as an argument so a test can place it. It resolves reservations a dead
 * process left open, then deletes what no decision can still read. Each kind
 * is taken in rounds while a round comes back full, and at most a fixed number
 * of them, so a tenant with a backlog costs a bounded amount per pass and the
 * next pass takes the rest.
 */
export async function upkeepBudget(tx: AssistantTx, now: Date): Promise<BudgetUpkeepReport> {
  // A row a live call holds is waited for briefly and then left to the next pass.
  await tx.execute(sql`set local lock_timeout = '2s'`);
  const budget = budgetRepository(tx);
  const leases = leaseRepository(tx);
  let released = 0;
  let charged = 0;
  await drain(async () => {
    const swept = await budget.sweep(now, RESERVATION_SWEEP_AFTER_MS);
    released += swept.released;
    charged += swept.charged;
    return swept.released + swept.charged;
  }, MAX_LIMIT);

  const cutoffs = upkeepCutoffs(now);
  let reservations = 0;
  let counters = 0;
  await drain(async () => {
    const pruned = await budget.prune(cutoffs, UPKEEP_BATCH);
    reservations += pruned.reservations;
    counters += pruned.counters;
    return pruned.reservations + pruned.counters;
  }, UPKEEP_BATCH);
  const lapsed = await drain(() => leases.prune(cutoffs.leasesBefore, UPKEEP_BATCH), UPKEEP_BATCH);
  return {
    reservationsReleased: released,
    reservationsCharged: charged,
    reservationsDeleted: reservations,
    countersDeleted: counters,
    leasesDeleted: lapsed,
  };
}
