import { type RemovalOutcome, refusedBy, removalOutcome } from '#/shared/lib/services/failure';
import type { GatewayResult } from '#/shared/lib/services/result';

export const REMOVED_TEXT = 'The tenant’s own relay was removed.';

const ALREADY_NONE = 'The tenant already had none. The page is read again.';

export function removeConsequence(): string {
  return 'The relay and its stored password are deleted. Mail then goes through the deployment’s sender if it has one, and is only logged if not. Setting a relay again means entering its password again.';
}

export function removeOutcome(result: GatewayResult<unknown>): RemovalOutcome {
  return removalOutcome(
    result,
    { doneText: REMOVED_TEXT, alreadyGoneText: ALREADY_NONE },
    {
      name: 'The relay',
      verb: 'removed',
      lookAt: 'the page',
      refused: refusedBy('manage-tenant'),
    },
  );
}
