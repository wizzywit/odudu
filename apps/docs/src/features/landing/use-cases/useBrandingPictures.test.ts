import { describe, expect, it } from 'vitest';
import { useBrandingPictures } from '@site/src/features/landing/use-cases/useBrandingPictures';
import { resultOf } from '@site/tests/support/hook';
import { PAGES_BASE } from '@site/site.config';

describe('useBrandingPictures', () => {
  it('lists the Odudu look then the other brand, light then dark, each sized', () => {
    const pictures = resultOf(useBrandingPictures);
    expect(pictures.map(({ look, scheme, src }) => [look, scheme, src])).toEqual([
      ['odudu', 'light', `${PAGES_BASE}server-pages/look-odudu-light.webp`],
      ['odudu', 'dark', `${PAGES_BASE}server-pages/look-odudu-dark.webp`],
      ['other', 'light', `${PAGES_BASE}server-pages/look-other-light.webp`],
      ['other', 'dark', `${PAGES_BASE}server-pages/look-other-dark.webp`],
    ]);
    for (const picture of pictures) {
      expect(picture.width).toBe(460);
      expect(picture.alt.length).toBeGreaterThan(20);
    }
  });
});
