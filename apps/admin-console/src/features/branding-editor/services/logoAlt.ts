import { MAX_ALT_LENGTH } from '@odudu/contracts';
import {
  imageField,
  type ImageSlot,
  type ImageValues,
  type Logo,
} from '#/features/branding-editor/services/imageValues';

export const ALT_LABEL = 'Alt text';

export const ALT_RULE = `Required: what the logo shows, for people who cannot see it. Up to ${String(MAX_ALT_LENGTH)} characters.`;

export function altProblem(alt: string): string | undefined {
  if (alt.trim() === '') return 'Describe the logo; it is required.';
  return alt.length > MAX_ALT_LENGTH
    ? `Keep it to ${String(MAX_ALT_LENGTH)} characters or fewer.`
    : undefined;
}

// The logo of a slot with its alt text changed, or null where there is none.
export function altEdited(
  values: ImageValues,
  slot: 'logo' | 'darkLogo',
  alt: string,
): Logo | null {
  const logo = slot === 'logo' ? values['assets.logo'] : values['assets.darkLogo'];
  return logo === null ? null : { assetId: logo.assetId, alt };
}

export function logoOf(assetId: string, previous: Logo | null): Logo {
  return { assetId, alt: previous?.alt ?? '' };
}

const ALT_HOLD = 'Describe each logo before saving: alt text is required.';

export function imagesHold(values: ImageValues): string | undefined {
  const logos = [values['assets.logo'], values['assets.darkLogo']];
  return logos.some((logo) => logo !== null && altProblem(logo.alt) !== undefined)
    ? ALT_HOLD
    : undefined;
}

// Whether a logo's alt text differs from the saved one.
export function altChanged(saved: ImageValues, now: ImageValues, slot: ImageSlot): boolean {
  const before = saved[imageField(slot)];
  const after = now[imageField(slot)];
  const was = before !== null && 'alt' in before ? before.alt : null;
  const is = after !== null && 'alt' in after ? after.alt : null;
  return was !== is && is !== null;
}
