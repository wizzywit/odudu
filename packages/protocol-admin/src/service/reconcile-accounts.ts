import { type CredentialType } from '@odudu/domain-identity';

export interface AccountFacts {
  readonly subjectId: string;
  readonly createdAt: Date;
  readonly emailVerified: boolean;
  /** A session, a grant or a credential that has been used. */
  readonly hasSignIns: boolean;
}

export type RefusalReason = 'several_have_sign_ins' | 'unverified_account_has_sign_ins';

export interface Loser {
  readonly subjectId: string;
  /**
   * False when the survivor's address is verified and this account's is not:
   * whoever made it never proved the address, so what they set up is not
   * handed to the account that did.
   */
  readonly carriesOver: boolean;
}

export type GroupPlan =
  | { readonly kind: 'merge'; readonly survivorId: string; readonly losers: readonly Loser[] }
  | { readonly kind: 'refused'; readonly reason: RefusalReason };

function precedes(a: AccountFacts, b: AccountFacts): boolean {
  if (a.emailVerified !== b.emailVerified) return a.emailVerified;
  const byAge = a.createdAt.getTime() - b.createdAt.getTime();
  return byAge === 0 ? a.subjectId < b.subjectId : byAge < 0;
}

/** The account with a verified address, then the oldest, then the lowest id. */
export function chooseSurvivor(members: readonly AccountFacts[]): AccountFacts {
  const [first, ...rest] = members;
  if (first === undefined) throw new Error('a group of accounts has at least one member');
  return rest.reduce((best, candidate) => (precedes(candidate, best) ? candidate : best), first);
}

export function planGroup(members: readonly AccountFacts[]): GroupPlan {
  if (members.filter((member) => member.hasSignIns).length > 1) {
    return { kind: 'refused', reason: 'several_have_sign_ins' };
  }
  const survivor = chooseSurvivor(members);
  const others = members
    .filter((member) => member.subjectId !== survivor.subjectId)
    .sort((a, b) => (a.subjectId < b.subjectId ? -1 : 1));
  const left = (loser: AccountFacts): boolean => survivor.emailVerified && !loser.emailVerified;
  if (others.some((loser) => left(loser) && loser.hasSignIns)) {
    return { kind: 'refused', reason: 'unverified_account_has_sign_ins' };
  }
  return {
    kind: 'merge',
    survivorId: survivor.subjectId,
    losers: others.map((loser) => ({ subjectId: loser.subjectId, carriesOver: !left(loser) })),
  };
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

export interface MovedCounts {
  readonly credentials: number;
  readonly sessions: number;
  readonly grants: number;
  readonly consents: number;
}

export const NOTHING_MOVED: MovedCounts = { credentials: 0, sessions: 0, grants: 0, consents: 0 };

export function addMoved(a: MovedCounts, b: MovedCounts): MovedCounts {
  return {
    credentials: a.credentials + b.credentials,
    sessions: a.sessions + b.sessions,
    grants: a.grants + b.grants,
    consents: a.consents + b.consents,
  };
}

/** What became of one address that several accounts held. */
export type GroupOutcome =
  | { readonly kind: 'gone' }
  | { readonly kind: 'merged'; readonly retired: number; readonly moved: MovedCounts }
  | { readonly kind: 'would_merge'; readonly retired: number }
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
        accounts_retired: report.accounts_retired + outcome.retired,
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
