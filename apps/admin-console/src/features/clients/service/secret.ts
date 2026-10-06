import { CLIENT_SECRET_GRACE_MAX_SECONDS } from '@odudu/contracts/admin';
import { clientRefusal } from '#/features/clients/service/refusal.ts';
import { writeFailureText } from '#/shared/service/failure.ts';
import { formatDuration } from '#/shared/service/format.ts';
import type { GatewayFailure } from '#/shared/service/result.ts';

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
