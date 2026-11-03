import { describe, expect, it } from 'vitest';
import {
  imageFields,
  imageNote,
  IMAGES_TITLE,
} from '#/features/branding-editor/services/imageSection';
import { SLOT_RULES } from '#/features/branding-editor/services/imageSlots';

const NONE = {
  'assets.logo': null,
  'assets.darkLogo': null,
  'assets.favicon': null,
  'assets.background': null,
} as const;

describe('the images section', () => {
  it('is titled Images and names an image by the start of its id', () => {
    expect(IMAGES_TITLE).toBe('Images');
    expect(imageNote('abcdef012345')).toBe('An image is set (abcdef01).');
  });

  it('names each field for its slot and says whether an image is set', () => {
    const fields = imageFields({ ...NONE, 'assets.favicon': { assetId: 'f1' } });
    expect(fields['assets.logo'].label).toBe(SLOT_RULES.logo.label);
    expect(fields['assets.background'].label).toBe(SLOT_RULES.background.label);
    expect(fields['assets.logo'].describe?.(null)).toBe('no image');
    expect(fields['assets.favicon'].describe?.({ assetId: 'f1' })).toBe('an uploaded image');
  });
});
