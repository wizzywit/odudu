import type { ThemeView } from '#/features/branding-editor/types/theme';
import { describe, expect, it } from 'vitest';
import { imageRequest, imageValues } from '#/features/branding-editor/services/imageValues';
import { draftedView } from '#/testing/brandingFixtures';

describe('the images in a request', () => {
  const drafted = draftedView() as ThemeView;

  it('leave an image out when it is null, so the layer below supplies it', () => {
    const images = imageRequest(drafted, {
      ...imageValues(drafted),
      'assets.logo': null,
    });
    expect(images.assets).toEqual({});
  });

  it('read a theme back into the same values they were made from', () => {
    expect(imageValues(drafted)['assets.logo']).toMatchObject({ alt: 'Acme' });
  });
});
