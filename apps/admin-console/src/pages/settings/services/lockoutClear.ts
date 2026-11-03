import type { ClearLockoutsResponse } from '@odudu/contracts/admin';
import { holds } from '#/shared/services/access';
import { refusedBy, writeFailureText } from '#/shared/services/failure';
import { counted } from '#/shared/services/format';
import type { AdminCapability, Authority } from '#/shared/services/principal';
import type { GatewayFailure } from '#/shared/services/result';
import { CLEAR_HEADING, CLEAR_RULE, LOCKOUTS_NEEDS } from '#/pages/settings/services/lockouts';

// The most accounts one request clears; the server does the rest on the next.
const CLEAR_LIMIT = '10,000';

export type LockoutClearState = 'checking' | 'ready' | 'lacking';

export function lockoutClearState(authority: Authority | undefined): LockoutClearState {
  if (authority === undefined) return 'checking';
  return holds(authority, LOCKOUTS_NEEDS) ? 'ready' : 'lacking';
}

// `login_failures` holds one row per subject, and a wrong password and a
// wrong second factor are counted in the same row, so clearing it resets both.
export function clearConsequence(tenant: string): string {
  return `This clears every lockout in ${tenant}: the count of every wrong password and every wrong second factor, for each account that has one. Every account locked out now can try again at once, and anybody guessing against an account starts again from none. A subject that holds an admin capability you do not hold keeps its count. At most ${CLEAR_LIMIT} accounts are cleared per request; clearing again clears the next. The clear is recorded in the tenant’s audit trail.`;
}

export function clearedText(tenant: string, answer: ClearLockoutsResponse): string {
  const head =
    answer.cleared > 0
      ? `Cleared the failed sign-ins of ${counted(answer.cleared, 'account', 'accounts')} in ${tenant}.`
      : answer.beyond_ceiling > 0
        ? `No failed sign-ins in ${tenant} were cleared.`
        : `Nobody in ${tenant} had failed sign-ins to clear.`;
  const more =
    answer.remaining > 0
      ? ` More are left: clear every lockout again to clear the next ${CLEAR_LIMIT}.`
      : '';
  const kept =
    answer.beyond_ceiling === 1
      ? ' 1 was kept: its subject holds an admin capability you do not hold.'
      : answer.beyond_ceiling > 1
        ? ` ${String(answer.beyond_ceiling)} were kept: their subjects hold an admin capability you do not hold.`
        : '';
  return `${head}${more}${kept}`;
}

// Kept beside the action, since the toast that says the same is gone in seconds.
export function clearMoreText(tenant: string, answer: ClearLockoutsResponse): string | null {
  if (answer.remaining <= 0) return null;
  return `More failed sign-ins are left in ${tenant}: clear every lockout again to clear the next ${CLEAR_LIMIT}.`;
}

export function clearFailure(tenant: string, failure: GatewayFailure): string {
  return writeFailureText(failure, {
    name: `The clearing of every lockout in ${tenant}`,
    verb: 'done',
    lookAt: 'a subject’s lockout',
    refused: refusedBy(LOCKOUTS_NEEDS),
  });
}

export interface ClearWords {
  heading: string;
  rule: string;
  needs: AdminCapability;
  lacking: string;
  dialogTitle: string;
  confirmLabel: string;
  consequence: string;
}

export function clearWords(tenant: string): ClearWords {
  return {
    heading: CLEAR_HEADING,
    rule: CLEAR_RULE,
    needs: LOCKOUTS_NEEDS,
    lacking: 'Clearing every lockout',
    dialogTitle: `${CLEAR_HEADING} in ${tenant}?`,
    confirmLabel: CLEAR_HEADING,
    consequence: clearConsequence(tenant),
  };
}
