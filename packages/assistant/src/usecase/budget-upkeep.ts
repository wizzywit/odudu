import { MAX_LIMIT } from '@odudu/contracts/admin';
import { budgetRepository } from '#/repository/budgets';
import { leaseRepository } from '#/repository/leases';
import type { AssistantTx } from '#/repository/tx';
import { drain } from '#/service/drain';
import {
  LAPSED_LEASE_RETENTION_DAYS,
  MONTHLY_COUNTER_RETENTION_DAYS,
  RESERVATION_SWEEP_AFTER_MS,
  SETTLED_RESERVATION_RETENTION_DAYS,
  SHORT_COUNTER_RETENTION_DAYS,
  UPKEEP_BATCH,
} from '#/service/limits';

export interface BudgetUpkeepReport {
  /** Open reservations whose call never reached the provider, given back. */
  readonly reservationsReleased: number;
  /** Open reservations whose call was sent, counted in full because their cost is unknown. */
  readonly reservationsCharged: number;
  readonly reservationsDeleted: number;
  readonly countersDeleted: number;
  readonly leasesDeleted: number;
}

const DAY_MS = 86_400_000;

const before = (now: Date, days: number): Date => new Date(now.getTime() - days * DAY_MS);

/**
 * The assistant's budget upkeep for the tenant `tx` is bound to, taking `now`
 * as an argument so a test can place it. It resolves reservations a dead
 * process left open, then deletes what no decision can still read. Each kind
 * is taken in rounds while a round comes back full, and at most a fixed number
 * of them, so a tenant with a backlog costs a bounded amount per pass and the
 * next pass takes the rest.
 */
export async function upkeepBudget(tx: AssistantTx, now: Date): Promise<BudgetUpkeepReport> {
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

  const cutoffs = {
    shortWindowsBefore: before(now, SHORT_COUNTER_RETENTION_DAYS),
    monthlyWindowsBefore: before(now, MONTHLY_COUNTER_RETENTION_DAYS),
    settledBefore: before(now, SETTLED_RESERVATION_RETENTION_DAYS),
  };
  let reservations = 0;
  let counters = 0;
  await drain(async () => {
    const pruned = await budget.prune(cutoffs, UPKEEP_BATCH);
    reservations += pruned.reservations;
    counters += pruned.counters;
    return pruned.reservations + pruned.counters;
  }, 1);
  const lapsed = await drain(
    () => leases.prune(before(now, LAPSED_LEASE_RETENTION_DAYS), UPKEEP_BATCH),
    1,
  );
  return {
    reservationsReleased: released,
    reservationsCharged: charged,
    reservationsDeleted: reservations,
    countersDeleted: counters,
    leasesDeleted: lapsed,
  };
}
