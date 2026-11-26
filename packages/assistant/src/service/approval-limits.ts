// How many changes the assistant may leave waiting at once, so one answer, even
// one led astray by text it read, cannot take the person's whole allowance of
// pending approvals (P5 allows 20 across the assistant and CIBA) from the other
// agents that ask them. Both are lower than P5's, never higher.
export const ASSISTANT_PENDING_PER_CONVERSATION = 5;
export const ASSISTANT_PENDING_PER_OWNER = 10;

export type CapRefusal = 'conversation_cap' | 'owner_cap';

/** Which cap a new proposal would pass, given what already waits, or null. */
export function capRefusal(held: {
  readonly inConversation: number;
  readonly forOwner: number;
}): CapRefusal | null {
  if (held.inConversation >= ASSISTANT_PENDING_PER_CONVERSATION) return 'conversation_cap';
  if (held.forOwner >= ASSISTANT_PENDING_PER_OWNER) return 'owner_cap';
  return null;
}
