import type { Promotion } from '#/entities/signing-key';
import { formatAbsolute } from '#/shared/services/format';

export function promotionLabel(promotion: Promotion): string {
  switch (promotion.kind) {
    case 'ready':
      return 'Ready';
    case 'unknown':
      return 'Unknown';
    case 'algorithm':
      return 'Changes algorithm';
    default:
      return 'Not ready';
  }
}

export function promotionText(promotion: Promotion): string {
  switch (promotion.kind) {
    case 'ready':
      return 'Ready to promote.';
    case 'young':
      return `Ready from ${formatAbsolute(promotion.at)}: until then a relying party may not have fetched its public key.`;
    case 'algorithm':
      return `Its algorithm differs from the active key’s (${promotion.active}). Promoting it changes the algorithm every new token is signed with: that is how a tenant migrates, once its clients are ready for it.`;
    case 'replaced':
      return 'Not offered as ready: it is older than the active key, so it is probably the key a promotion replaced. That one is for retiring.';
    case 'unknown':
      return 'Whether it is ready is judged against the active key, which has not been read.';
  }
}

export function promoteWarning(promotion: Promotion): string | null {
  if (promotion.kind === 'ready') return null;
  return `${promotionText(promotion)} Promoting it now is your call: the server does not refuse it.`;
}

function promotionTone(promotion: Promotion): PromotionReading['tone'] {
  switch (promotion.kind) {
    case 'ready':
      return 'active';
    case 'algorithm':
      return 'neutral';
    default:
      return 'warning';
  }
}

export interface PromotionReading {
  ready: boolean;
  tone: 'active' | 'warning' | 'neutral';
  label: string;
  text: string;
}

export function promotionReading(promotion: Promotion): PromotionReading {
  return {
    ready: promotion.kind === 'ready',
    tone: promotionTone(promotion),
    label: promotionLabel(promotion),
    text: promotionText(promotion),
  };
}
