import { bytesText, KIB } from '#/shared/services/format';
import type { ImageSlot } from '#/features/branding/services/imageValues';

export interface SlotRule {
  label: string;
  hint: string;
  bytes: number;
  side: number;
}

const SMALL = { bytes: 256 * KIB, side: 1024 } as const;

// The limits the server holds each kind to, stated beside its upload. The
// server decides; stating them first saves a trip for the usual mistake.
export const SLOT_RULES: Readonly<Record<ImageSlot, SlotRule>> = {
  logo: { label: 'Logo', hint: 'Shown above the form.', ...SMALL },
  darkLogo: {
    label: 'Logo for the dark scheme',
    hint: 'Used instead of the logo when the page is dark, so a dark logo does not vanish.',
    ...SMALL,
  },
  favicon: { label: 'Favicon', hint: 'The icon in the browser tab.', ...SMALL },
  background: {
    label: 'Background image',
    hint: 'Behind the page.',
    bytes: 1024 * KIB,
    side: 2560,
  },
};

export const ACCEPTED_TYPE_LIST = ['image/png', 'image/jpeg', 'image/webp'];

export const ACCEPTED_TYPES = ACCEPTED_TYPE_LIST.join(',');

export const TENANT_IMAGE_CAP = bytesText(8 * 1024 * KIB);

export function limitText(slot: ImageSlot): string {
  const rule = SLOT_RULES[slot];
  return `PNG, JPEG or WebP, up to ${bytesText(rule.bytes)} and ${String(rule.side)} pixels on the longer side. All the tenant’s images together may total ${TENANT_IMAGE_CAP}.`;
}
