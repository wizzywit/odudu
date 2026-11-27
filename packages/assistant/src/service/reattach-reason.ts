/**
 * Why a message to a conversation was refused for want of a grant, in the three
 * ways a person can act on: the conversation is hidden (restore it), its sign-in
 * was ended for a reason that is not the person's own (start a new one), or the
 * sign-in they hold now may not have it (a capability, the tenant's setting or the
 * session is missing, so it may work again later).
 */
export type EndedReason = 'archived' | 'revoked' | 'not_allowed';

// The grant refusals that mean the conversation's own grant can never be made
// live again, as opposed to one this sign-in is not allowed to derive.
const ENDED_FOR_GOOD: ReadonlySet<string> = new Set([
  'revoked_for_cause',
  'conversation_grant_missing',
  'conversation_grant_not_assistant',
  'subject_mismatch',
]);

export function endedReasonOf(code: string): EndedReason {
  if (code === 'conversation_archived') return 'archived';
  return ENDED_FOR_GOOD.has(code) ? 'revoked' : 'not_allowed';
}
