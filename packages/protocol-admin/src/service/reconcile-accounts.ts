import { type CredentialType } from '@odudu/domain-identity';

/**
 * What a sign-in leaves behind that outlives it. A password sign-in stamps
 * no credential, and the reaper deletes expired sessions and grants, so a
 * person who only ever used a password is seen through the audit trail,
 * which retention can also empty: an old enough sign-in may be invisible.
 */
export interface SignInTraces {
  readonly session: boolean;
  readonly grant: boolean;
  readonly usedCredential: boolean;
  readonly loginEvent: boolean;
}

export function hasSignedIn(traces: SignInTraces): boolean {
  return traces.session || traces.grant || traces.usedCredential || traces.loginEvent;
}

export interface AccountRecord {
  readonly subjectId: string;
  readonly email: string | null;
  readonly createdAt: Date;
  readonly emailVerified: boolean;
  readonly traces: SignInTraces;
}

export interface AccountFacts {
  readonly subjectId: string;
  readonly email: string | null;
  readonly createdAt: Date;
  readonly emailVerified: boolean;
  readonly hasSignIns: boolean;
}

export function accountFacts(record: AccountRecord): AccountFacts {
  return {
    subjectId: record.subjectId,
    email: record.email,
    createdAt: record.createdAt,
    emailVerified: record.emailVerified,
    hasSignIns: hasSignedIn(record.traces),
  };
}

export type RefusalReason =
  | 'several_have_sign_ins'
  | 'no_verified_account'
  | 'unverified_account_has_sign_ins'
  | 'loser_signed_in';

export interface Loser {
  readonly subjectId: string;
  readonly email: string | null;
  /** False for an unverified account: whoever made it never proved the address. */
  readonly carriesOver: boolean;
}

export type GroupPlan =
  | { readonly kind: 'gone' }
  | {
      readonly kind: 'merge';
      readonly survivorId: string;
      readonly losers: readonly Loser[];
    }
  | { readonly kind: 'refused'; readonly reason: RefusalReason };

// A verified address first; then the account that has signed in, which is
// the one the person uses when exactly one has (a group where two have is
// refused before this is asked); then the oldest, then the lowest id.
function precedes(a: AccountFacts, b: AccountFacts): boolean {
  if (a.emailVerified !== b.emailVerified) return a.emailVerified;
  if (a.hasSignIns !== b.hasSignIns) return a.hasSignIns;
  const byAge = a.createdAt.getTime() - b.createdAt.getTime();
  return byAge === 0 ? a.subjectId < b.subjectId : byAge < 0;
}

export function chooseSurvivor(members: readonly AccountFacts[]): AccountFacts {
  const [first, ...rest] = members;
  if (first === undefined) throw new Error('a group of accounts has at least one member');
  return rest.reduce((best, candidate) => (precedes(candidate, best) ? candidate : best), first);
}

function refusal(members: readonly AccountFacts[]): RefusalReason | null {
  if (members.filter((member) => member.hasSignIns).length > 1) return 'several_have_sign_ins';
  if (!members.some((member) => member.emailVerified)) return 'no_verified_account';
  if (members.some((member) => !member.emailVerified && member.hasSignIns)) {
    return 'unverified_account_has_sign_ins';
  }
  return null;
}

/**
 * Whether a plan made from a second read of the same group is the plan the
 * first read made: the same survivor, the same accounts to retire, and still
 * mergeable. A sign-in that lands between the two reads breaks it.
 */
export function planHolds(first: GroupPlan, second: GroupPlan): boolean {
  if (first.kind !== 'merge' || second.kind !== 'merge') return false;
  return (
    first.survivorId === second.survivorId &&
    first.losers.map((l) => l.subjectId).join() === second.losers.map((l) => l.subjectId).join()
  );
}

export function planGroup(members: readonly AccountFacts[]): GroupPlan {
  if (members.length < 2) return { kind: 'gone' };
  const reason = refusal(members);
  if (reason !== null) return { kind: 'refused', reason };
  const survivor = chooseSurvivor(members);
  const losers = members
    .filter((member) => member.subjectId !== survivor.subjectId)
    .sort((a, b) => (a.subjectId < b.subjectId ? -1 : 1))
    .map((loser) => ({
      subjectId: loser.subjectId,
      email: loser.email,
      carriesOver: loser.emailVerified,
    }));
  return { kind: 'merge', survivorId: survivor.subjectId, losers };
}

const ONE_PER_PERSON: ReadonlySet<CredentialType> = new Set([
  'password',
  'totp',
  'recovery-code',
  'password-history',
]);

/**
 * Passkeys are many and always move. Every other kind is one set or one
 * secret, so it moves only where the survivor holds none of it.
 */
export function credentialTypesToMove(
  survivorHolds: ReadonlySet<CredentialType>,
  loserHolds: ReadonlySet<CredentialType>,
): CredentialType[] {
  return [...loserHolds].filter((type) => !ONE_PER_PERSON.has(type) || !survivorHolds.has(type));
}

export interface MovePlan {
  readonly moveRows: boolean;
  readonly credentialTypes: readonly CredentialType[];
  readonly moveRecoveryStamp: boolean;
}

export function movePlan(
  carriesOver: boolean,
  survivorHolds: ReadonlySet<CredentialType>,
  loserHolds: ReadonlySet<CredentialType>,
): MovePlan {
  if (!carriesOver) return { moveRows: false, credentialTypes: [], moveRecoveryStamp: false };
  const credentialTypes = credentialTypesToMove(survivorHolds, loserHolds);
  return {
    moveRows: true,
    credentialTypes,
    moveRecoveryStamp: credentialTypes.includes('recovery-code'),
  };
}

export interface MovedCounts {
  readonly credentials: number;
  readonly consents: number;
}

export const NOTHING_MOVED: MovedCounts = { credentials: 0, consents: 0 };

export function addMoved(a: MovedCounts, b: MovedCounts): MovedCounts {
  return {
    credentials: a.credentials + b.credentials,
    consents: a.consents + b.consents,
  };
}

/**
 * One account folded into the survivor, or one a dry run would fold. It is
 * the only place the retired account's former address is written down.
 */
export interface PairEvent {
  readonly event: 'merged' | 'would_merge';
  readonly tenant_id: string;
  readonly survivor: string;
  readonly loser: string;
  readonly former_address: string | null;
  readonly carried_over: boolean;
  /** Absent on a dry run: what would move is not computed. */
  readonly moved?: MovedCounts;
}

/** What became of one address that several accounts held. */
export type GroupOutcome =
  | { readonly kind: 'gone' }
  | {
      readonly kind: 'merged';
      readonly moved: MovedCounts;
      readonly pairs: readonly PairEvent[];
    }
  | { readonly kind: 'would_merge'; readonly pairs: readonly PairEvent[] }
  | {
      readonly kind: 'refused';
      readonly reason: RefusalReason;
      readonly subjectIds: readonly string[];
    }
  | { readonly kind: 'failed'; readonly cause: string };

export interface Refusal {
  readonly tenant_id: string;
  readonly reason: RefusalReason;
  readonly subject_ids: readonly string[];
}

export interface Failure {
  readonly tenant_id: string;
  readonly cause: string;
}

export interface ReconcileReport {
  readonly dry_run: boolean;
  readonly tenants: number;
  readonly groups: number;
  readonly merged: number;
  readonly would_merge: number;
  readonly accounts_retired: number;
  readonly moved: MovedCounts;
  readonly refused: number;
  readonly failed: number;
  /** The first `REPORTED_PROBLEMS` of each, so the output stays bounded. */
  readonly refusals: readonly Refusal[];
  readonly failures: readonly Failure[];
}

export const REPORTED_PROBLEMS = 100;

export function emptyReport(dryRun: boolean): ReconcileReport {
  return {
    dry_run: dryRun,
    tenants: 0,
    groups: 0,
    merged: 0,
    would_merge: 0,
    accounts_retired: 0,
    moved: NOTHING_MOVED,
    refused: 0,
    failed: 0,
    refusals: [],
    failures: [],
  };
}

export function countTenant(report: ReconcileReport): ReconcileReport {
  return { ...report, tenants: report.tenants + 1 };
}

function capped<T>(items: readonly T[], item: T): readonly T[] {
  return items.length < REPORTED_PROBLEMS ? [...items, item] : items;
}

export function tally(
  report: ReconcileReport,
  tenantId: string,
  outcome: GroupOutcome,
): ReconcileReport {
  switch (outcome.kind) {
    case 'gone':
      return report;
    case 'merged':
      return {
        ...report,
        groups: report.groups + 1,
        merged: report.merged + 1,
        accounts_retired: report.accounts_retired + outcome.pairs.length,
        moved: addMoved(report.moved, outcome.moved),
      };
    case 'would_merge':
      return { ...report, groups: report.groups + 1, would_merge: report.would_merge + 1 };
    case 'refused':
      return {
        ...report,
        groups: report.groups + 1,
        refused: report.refused + 1,
        refusals: capped(report.refusals, {
          tenant_id: tenantId,
          reason: outcome.reason,
          subject_ids: outcome.subjectIds,
        }),
      };
    case 'failed':
      return {
        ...report,
        groups: report.groups + 1,
        failed: report.failed + 1,
        failures: capped(report.failures, { tenant_id: tenantId, cause: outcome.cause }),
      };
  }
}

/** The error's kind and database code, never its message, which can quote an address. */
export function describeFailure(error: unknown): string {
  if (!(error instanceof Error)) return 'unknown';
  const code = 'code' in error && typeof error.code === 'string' ? ` ${error.code}` : '';
  return `${error.name}${code}`;
}
