import type { SessionsEnded } from '#/pages/tenant-sessions/types/tenantSession';
import { refusedBy, writeFailureText } from '#/shared/services/failure';
import { counted } from '#/shared/services/format';
import type { GatewayFailure } from '#/shared/services/result';

// The most sessions one request ends; the server does the rest on the next.
const END_LIMIT = 500;

// `ownTenant`: the operator's own console session belongs to this tenant.
export function endConsequence(tenant: string, ownTenant: boolean): string {
  const own = ownTenant
    ? ' Your own console session is one of them: the console signs you out at its next request.'
    : '';
  return `Every live session in ${tenant} ends, whoever holds it: each user is signed out, each session's grants are revoked, and each client with a back-channel logout URI is told. A grant bound to no session, an offline_access refresh token, is left. A session whose subject holds an admin capability you do not hold is left alone. At most ${String(END_LIMIT)} end per request; ending again ends the next.${own}`;
}

export function endedText(tenant: string, answer: SessionsEnded): string {
  const ended = `${counted(answer.ended, 'session', 'sessions')} in ${tenant} ended.`;
  const more =
    answer.remaining > 0
      ? ` More are still live: end every session again to end the next ${String(END_LIMIT)}.`
      : '';
  const left =
    answer.beyondCeiling === 1
      ? ' 1 was left alone: its subject holds an admin capability you do not hold.'
      : answer.beyondCeiling > 1
        ? ` ${String(answer.beyondCeiling)} were left alone: their subjects hold an admin capability you do not hold.`
        : '';
  return `${ended}${more}${left}`;
}

// Kept beside the action, since the toast that says the same is gone in seconds.
export function endMoreText(tenant: string, answer: SessionsEnded): string | null {
  if (answer.remaining <= 0) return null;
  return `More sessions are still live in ${tenant}: end every session again to end the next ${String(END_LIMIT)}.`;
}

export function endFailure(tenant: string, failure: GatewayFailure): string {
  return writeFailureText(failure, {
    name: `The end of every session in ${tenant}`,
    verb: 'done',
    lookAt: 'the sessions list',
    refused: refusedBy('manage-sessions'),
  });
}
