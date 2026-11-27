import type { AssistantTier } from '@odudu/contracts/admin';

/**
 * Whether a decision carries what its card asks of it. Only an approval of a
 * tier C change asks anything: the exact text the server wrote on the card, as
 * the person typed it. A refusal needs nothing, and a card with no text to type
 * is never approved, so a stored card that lost it fails closed.
 */
export function confirmationAccepted(
  card: { readonly tier: AssistantTier; readonly confirmWith: string | null },
  approve: boolean,
  confirm: string | undefined,
): boolean {
  if (!approve || card.tier !== 'C') return true;
  return card.confirmWith !== null && confirm === card.confirmWith;
}
