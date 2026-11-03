import type { SectionFields } from '#/shared/services/sectionSave';
import { SLOT_RULES } from '#/features/branding-editor/services/imageSlots';
import type { ImageSlot, ImageValues } from '#/features/branding-editor/services/imageValues';

export const IMAGES_LEAD =
  'Images are stored as soon as they are uploaded, and used only once the draft that names them is published.';

export const UPLOAD_LABEL = 'Upload';

export const REPLACE_LABEL = 'Replace';

export const REMOVE_LABEL = 'Remove from theme';

export const DELETE_LABEL = 'Delete image';

export const UPLOADING = 'Uploading…';

export const NO_IMAGE = 'No image: the layer below supplies it.';

export function imageNote(assetId: string): string {
  return `An image is set (${assetId.slice(0, 8)}).`;
}

export const IMAGES_TITLE = 'Images';

function describeImage(value: unknown): string {
  return value === null ? 'no image' : 'an uploaded image';
}

function imageEntry<V>(slot: ImageSlot, value: V) {
  return { value, label: SLOT_RULES[slot].label, kind: 'plain' as const, describe: describeImage };
}

export function imageFields(now: ImageValues): SectionFields<ImageValues> {
  return {
    'assets.logo': imageEntry('logo', now['assets.logo']),
    'assets.darkLogo': imageEntry('darkLogo', now['assets.darkLogo']),
    'assets.favicon': imageEntry('favicon', now['assets.favicon']),
    'assets.background': imageEntry('background', now['assets.background']),
  };
}
