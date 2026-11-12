import { withTenant, type Database, type TenantScopedDatabase } from '@odudu/db';
import { auditRepository } from '@odudu/domain-audit';
import { lockEmailForCreation, subjectRepository, userRepository } from '@odudu/domain-identity';
import { accountReconcileRepository } from '#/repository/account-reconcile';
import {
  addMoved,
  countTenant,
  credentialTypesToMove,
  describeFailure,
  emptyReport,
  NOTHING_MOVED,
  planGroup,
  tally,
  type GroupOutcome,
  type Loser,
  type MovedCounts,
  type ReconcileReport,
} from '#/service/reconcile-accounts';

/** Addresses read per page, and so the most one tenant's walk holds at a time. */
export const RECONCILE_CHUNK_GROUPS = 100;

type Repository = ReturnType<typeof accountReconcileRepository>;

async function carryOver(
  repository: Repository,
  survivorId: string,
  loserId: string,
  now: Date,
): Promise<MovedCounts> {
  const types = credentialTypesToMove(
    await repository.credentialTypes(survivorId),
    await repository.credentialTypes(loserId),
  );
  const credentials = await repository.moveCredentials(loserId, survivorId, types);
  if (types.includes('recovery-code')) {
    await repository.moveRecoveryCodeStamp(loserId, survivorId);
  }
  return {
    credentials,
    sessions: await repository.moveSessions(loserId, survivorId),
    grants: await repository.moveGrants(loserId, survivorId),
    consents: await repository.moveConsents(loserId, survivorId, now),
  };
}

async function retire(
  tx: TenantScopedDatabase,
  repository: Repository,
  survivorId: string,
  loser: Loser,
  now: Date,
): Promise<MovedCounts> {
  const moved = loser.carriesOver
    ? await carryOver(repository, survivorId, loser.subjectId, now)
    : NOTHING_MOVED;
  await userRepository(tx).updateEmail(loser.subjectId, null);
  await subjectRepository(tx).setEnabled(loser.subjectId, false);
  await auditRepository(tx).record({
    eventType: 'admin_mutation',
    action: 'subject.reconcile',
    outcome: 'allowed',
    resourceType: 'subject',
    resourceId: loser.subjectId,
    detail: { survivor: survivorId, carried_over: loser.carriesOver, moved },
  });
  return moved;
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
  const members = await repository.lockAccounts(address);
  if (members.length < 2) return { kind: 'gone' };
  const plan = planGroup(members);
  if (plan.kind === 'refused') {
    return {
      kind: 'refused',
      reason: plan.reason,
      subjectIds: members.map((member) => member.subjectId),
    };
  }
  if (dryRun) return { kind: 'would_merge', retired: plan.losers.length };
  let moved = NOTHING_MOVED;
  for (const loser of plan.losers) {
    moved = addMoved(moved, await retire(tx, repository, plan.survivorId, loser, now));
  }
  return { kind: 'merged', retired: plan.losers.length, moved };
}

export interface ReconcileOptions {
  readonly dryRun: boolean;
  readonly chunkGroups?: number;
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
      report = tally(report, tenantId, await attempt(db, tenantId, address, now, options.dryRun));
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
