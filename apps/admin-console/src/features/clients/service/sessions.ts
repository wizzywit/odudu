import type { RevokeClientGrantsResponse } from '@odudu/contracts/admin';
import { writeFailureText } from '#/shared/service/failure.ts';
import type { GatewayFailure } from '#/shared/service/result.ts';
import { clientRefusal } from '#/features/clients/service/refusal.ts';

export const SESSIONS_CAPABILITY = 'manage-sessions';

export const SESSIONS_RULE =
  'The sessions that hold a grant through this client: who is signed in to it now. Ending one is done from the subject it belongs to.';

export const NO_SESSIONS = 'Nobody is signed in through this client.';

export const SESSIONS_NOUN = { one: 'session', other: 'sessions' };

export const REVOKE_HEADING = 'Revoke every token';
export const REVOKE_RULE =
  'Revokes every grant issued through this client that nothing has revoked, so no refresh token it holds is honoured again, without disabling it. A person still signed in can be issued a fresh grant, since no session is ended.';

export function revokeConsequence(name: string): string {
  return `Every grant issued through ${name} is revoked, whoever holds it: no refresh token it holds is honoured again, and an application using one must sign its people in again. It cannot be undone.`;
}

// What one call did, and whether another is owed: one call revokes at most 10,000.
export function revokedText(name: string, result: RevokeClientGrantsResponse): string {
  const parts = [
    `${String(result.revoked)} ${result.revoked === 1 ? 'grant' : 'grants'} of ${name} revoked.`,
  ];
  if (result.beyond_ceiling > 0) {
    parts.push(
      `${String(result.beyond_ceiling)} left alone, their subjects holding an admin capability you do not.`,
    );
  }
  if (result.remaining > 0) {
    parts.push(`${String(result.remaining)} more remain. Revoke again to continue.`);
  }
  return parts.join(' ');
}

export function revokeFailureText(failure: GatewayFailure, name: string): string {
  return writeFailureText(failure, {
    name: `The grants of ${name}`,
    verb: 'revoked',
    lookAt: 'the sessions here',
    refused: clientRefusal,
  });
}
