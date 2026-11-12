import { withTenant, type Database, type TenantScopedDatabase } from '@odudu/db';
import { auditRepository } from '@odudu/domain-audit';
import { lockEmailForCreation, subjectRepository, userRepository } from '@odudu/domain-identity';
import { accountReconcileRepository } from '#/repository/account-reconcile';
import {
  accountFacts,
  addMoved,
  countTenant,
  describeFailure,
  emptyReport,
  movePlan,
  NOTHING_MOVED,
  planGroup,
  tally,
  type GroupOutcome,
  type Loser,
  type MovedCounts,
  type PairEvent,
  type ReconcileReport,
} from '#/service/reconcile-accounts';

/** Addresses read per page, and so the most one tenant's walk holds at a time. */
export const RECONCILE_CHUNK_GROUPS = 100;

type Repository = ReturnType<typeof accountReconcileRepository>;

async function carryOver(
  repository: Repository,
  survivorId: string,
  loser: Loser,
  now: Date,
): Promise<MovedCounts> {
  const plan = movePlan(
    loser.carriesOver,
    await repository.credentialTypes(survivorId),
    await repository.credentialTypes(loser.subjectId),
  );
  if (!plan.moveRows) return NOTHING_MOVED;
  const credentials = await repository.moveCredentials(
    loser.subjectId,
    survivorId,
    plan.credentialTypes,
  );
  if (plan.moveRecoveryStamp) await repository.moveRecoveryCodeStamp(loser.subjectId, survivorId);
  return {
    credentials,
    sessions: await repository.moveSessions(loser.subjectId, survivorId),
    grants: await repository.moveGrants(loser.subjectId, survivorId),
    consents: await repository.moveConsents(loser.subjectId, survivorId, now),
  };
}

function pairOf(
  event: PairEvent['event'],
  tenantId: string,
  survivorId: string,
  loser: Loser,
  moved: MovedCounts,
): PairEvent {
  return {
    event,
    tenant_id: tenantId,
    survivor: survivorId,
    loser: loser.subjectId,
    former_address: loser.email,
    carried_over: loser.carriesOver,
    moved,
  };
}

async function retire(
  tx: TenantScopedDatabase,
  repository: Repository,
  tenantId: string,
  survivorId: string,
  loser: Loser,
  now: Date,
): Promise<PairEvent> {
  const moved = await carryOver(repository, survivorId, loser, now);
  await repository.clearPendingLinks(loser.subjectId);
  await userRepository(tx).updateEmail(loser.subjectId, null);
  await subjectRepository(tx).setEnabled(loser.subjectId, false);
  await auditRepository(tx).record({
    eventType: 'credential',
    action: 'account.reconciled',
    outcome: 'allowed',
    resourceType: 'subject',
    resourceId: loser.subjectId,
    detail: {
      survivor: survivorId,
      loser: loser.subjectId,
      carried_over: loser.carriesOver,
      moved,
    },
  });
  return pairOf('merged', tenantId, survivorId, loser, moved);
}

/**
 * Folds the accounts that hold one address into the one that stays, in the
 * caller's transaction. The address is read again under lock, so a group
 * that changed since it was found is judged as it is now.
 */
export async function reconcileGroup(
  tx: TenantScopedDatabase,
  tenantId: string,
  address: string,
  now: Date,
  dryRun: boolean,
): Promise<GroupOutcome> {
  await lockEmailForCreation(tx, tenantId, address);
  const repository = accountReconcileRepository(tx, tenantId);
  const members = (await repository.lockAccounts(address)).map(accountFacts);
  const plan = planGroup(members);
  if (plan.kind === 'gone') return { kind: 'gone' };
  if (plan.kind === 'refused') {
    return {
      kind: 'refused',
      reason: plan.reason,
      subjectIds: members.map((member) => member.subjectId),
    };
  }
  if (dryRun) {
    return {
      kind: 'would_merge',
      pairs: plan.losers.map((loser) =>
        pairOf('would_merge', tenantId, plan.survivorId, loser, NOTHING_MOVED),
      ),
    };
  }
  const pairs: PairEvent[] = [];
  for (const loser of plan.losers) {
    pairs.push(await retire(tx, repository, tenantId, plan.survivorId, loser, now));
  }
  return {
    kind: 'merged',
    moved: pairs.reduce((sum, pair) => addMoved(sum, pair.moved), NOTHING_MOVED),
    pairs,
  };
}

export interface ReconcileOptions {
  readonly dryRun: boolean;
  readonly chunkGroups?: number;
  /** Called after each pair is committed, so a caller can keep a complete log. */
  readonly onPair?: (pair: PairEvent) => void;
}

async function attempt(
  db: Database,
  tenantId: string,
  address: string,
  now: Date,
  dryRun: boolean,
): Promise<GroupOutcome> {
  try {
    return await withTenant(db, tenantId, (tx) =>
      reconcileGroup(tx, tenantId, address, now, dryRun),
    );
  } catch (error) {
    return { kind: 'failed', cause: describeFailure(error) };
  }
}

async function reconcileTenant(
  db: Database,
  tenantId: string,
  now: Date,
  options: ReconcileOptions,
  start: ReconcileReport,
): Promise<ReconcileReport> {
  const size = options.chunkGroups ?? RECONCILE_CHUNK_GROUPS;
  let report = countTenant(start);
  let after: string | null = null;
  for (;;) {
    const cursor: string | null = after;
    const page: string[] = await withTenant(db, tenantId, (tx) =>
      accountReconcileRepository(tx, tenantId).duplicateAddresses(cursor, size),
    );
    for (const address of page) {
      const outcome = await attempt(db, tenantId, address, now, options.dryRun);
      if ('pairs' in outcome) outcome.pairs.forEach((pair) => options.onPair?.(pair));
      report = tally(report, tenantId, outcome);
    }
    const last = page.at(-1);
    if (last === undefined || page.length < size) return report;
    after = last;
  }
}

/**
 * Finds the accounts in each tenant that hold one address apart from its
 * case and folds each group into one account, a transaction to a group. It
 * takes `now` and holds no timer, so an operator runs it as a command and a
 * test places it anywhere. A group that cannot be merged is reported and the
 * walk goes on; running it again finds only what is left.
 */
export async function reconcileDuplicateAccounts(
  db: Database,
  tenantIds: AsyncIterable<string> | readonly string[],
  now: Date,
  options: ReconcileOptions,
): Promise<ReconcileReport> {
  let report = emptyReport(options.dryRun);
  for await (const tenantId of tenantIds) {
    report = await reconcileTenant(db, tenantId, now, options, report);
  }
  return report;
}
