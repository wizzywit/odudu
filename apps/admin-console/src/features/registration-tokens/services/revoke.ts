import { writeRefusal } from '#/shared/services/capabilities';
import { removalOutcome, type RemovalOutcome } from '#/shared/services/failure';
import { counted } from '#/shared/services/format';
import type { GatewayResult } from '#/shared/services/result';

export const REVOKED_TEXT = 'The token was revoked.';

// The server answers a token that was used up or has expired as it answers a revoked one.
export const ALREADY_GONE =
  'That token is already gone: it was used up, expired or revoked. The list is read again.';

export function revokeConsequence(token: { remaining_uses: number }): string {
  return `Nobody can register a client with it again, and its ${counted(token.remaining_uses, 'use', 'uses')} left are lost. Clients it already registered are not affected.`;
}

// The dialog's consequence line: empty while no token is being revoked.
export function askedConsequence(asked: { remaining_uses: number } | null): string {
  return asked === null ? '' : revokeConsequence(asked);
}

export function revokeOutcome(result: GatewayResult<unknown>): RemovalOutcome {
  return removalOutcome(
    result,
    { doneText: REVOKED_TEXT, alreadyGoneText: ALREADY_GONE },
    {
      name: 'The token',
      verb: 'revoked',
      lookAt: 'the list',
      refused: (problem) => writeRefusal(problem, 'manage-clients'),
    },
  );
}
