import { CLIENT_SECRET_GRACE_MAX_SECONDS } from '@odudu/contracts/admin';
import { clientRefusal } from '#/pages/clients/services/refusal';
import { writeFailureText } from '#/shared/services/failure';
import { formatDuration } from '#/shared/services/format';
import type { GatewayFailure } from '#/shared/services/result';

export const SECRET_RULE =
  'Rotating makes a new secret, shown once. Until its grace period ends the previous secret keeps authenticating beside it, so an application can be given the new one without a gap. A grace of 0 s replaces it at once, the right answer to a leak.';

const PUBLIC_SECRET_FIXED = 'A public client has no secret to rotate.';

/** Why a client has no secret to rotate, or `null` when it holds one. */
export function secretFixedNote(client: {
  type: string;
  token_endpoint_auth_method: string;
}): string | null {
  if (client.type === 'public') return PUBLIC_SECRET_FIXED;
  const method = client.token_endpoint_auth_method;
  if (method === 'client_secret_basic' || method === 'client_secret_post') return null;
  return `A client that authenticates with ${method} has no secret to rotate.`;
}

export const GRACE_LABEL = 'Grace period';
export const GRACE_MAX = CLIENT_SECRET_GRACE_MAX_SECONDS;

export const GRACE_RULE = `How long the secret being replaced keeps authenticating. 0 s ends it at once. Up to ${formatDuration(GRACE_MAX)}: a longer window is a second standing credential nobody is tracking.`;

export function rotateConsequence(name: string, grace: number): string {
  const old =
    grace === 0
      ? 'stops working at once'
      : `keeps working for ${formatDuration(grace)}, then stops`;
  return `Rotating makes a new secret for ${name}, shown once. The current secret ${old}, and an application that has not been given the new one can no longer authenticate after that.`;
}

export function rotatedTitle(name: string): string {
  return `New client secret for ${name}`;
}

export function rotatedNote(name: string, grace: number): string {
  return grace === 0
    ? `${name}'s previous secret no longer works.`
    : `${name}'s previous secret keeps working for ${formatDuration(grace)}.`;
}

// A lost answer is never sent again, since a second rotation would replace the secret a first made.
export function rotationFailureText(failure: GatewayFailure, name: string): string {
  return writeFailureText(failure, {
    name: `The secret of ${name}`,
    verb: 'rotated',
    lookAt: "the client's previous secret expiry here",
    refused: clientRefusal,
  });
}

// The dialog's failure line: none until a rotation failed.
export function rotationProblem(failure: GatewayFailure | null, name: string): string | null {
  return failure === null ? null : rotationFailureText(failure, name);
}

export interface PreviousSecret {
  lead: string;
  // The instant it stops, or stopped, authenticating.
  at: string;
}

// The server keeps the instant until a reaper clears it, so one past is still
// returned: said in the past tense rather than as if it were live.
export function previousSecretLine(expiresAt: string | null, now: Date): PreviousSecret | null {
  if (expiresAt === null) return null;
  const live = new Date(expiresAt).getTime() > now.getTime();
  return {
    lead: live
      ? 'The previous secret authenticates until'
      : 'The previous secret stopped authenticating',
    at: expiresAt,
  };
}
