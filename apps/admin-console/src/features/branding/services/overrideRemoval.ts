import type { MessageOverride } from '@odudu/contracts/admin';
import { type RemovalOutcome, isStale, refusedBy, removalOutcome } from '#/shared/services/failure';
import type { GatewayResult } from '#/shared/services/result';

export const REMOVED_TEXT =
  'The override was removed. The page or mail shows the catalogue’s text again.';

export const STALE_REMOVAL =
  'That override changed after you saw it, so it was not removed. The list is read again: look at its text now, then remove it if you still want to.';

export const ALREADY_REMOVED = 'That override is already gone. The list is read again.';

export function removeConsequence(override: Pick<MessageOverride, 'locale' | 'key'>): string {
  return `Pages and mail in ${override.locale} show the catalogue’s text for ${override.key} again. Other languages are not affected.`;
}

export function askedRemoval(asked: Pick<MessageOverride, 'locale' | 'key'> | null): string {
  return asked === null ? '' : removeConsequence(asked);
}

export function removeOutcome(result: GatewayResult<unknown>): RemovalOutcome {
  const outcome = removalOutcome(
    result,
    { doneText: REMOVED_TEXT, alreadyGoneText: ALREADY_REMOVED },
    {
      name: 'The override',
      verb: 'removed',
      lookAt: 'the list',
      refused: refusedBy('manage-tenant'),
    },
  );
  // The version asked about is out of date, so asking again could only be
  // refused again: the dialog closes and the list, read again, is looked at.
  return !result.ok && isStale(result)
    ? { done: false, closes: true, text: STALE_REMOVAL }
    : outcome;
}
