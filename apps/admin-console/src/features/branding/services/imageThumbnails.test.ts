import { describe, expect, it } from 'vitest';
import {
  imageDataUrl,
  slotAssetIds,
  slotThumbnail,
  slotView,
  thumbnailAlt,
} from '#/features/branding/services/imageThumbnails';
import type { ImageValues } from '#/features/branding/services/values';

const none: ImageValues = {
  'assets.logo': null,
  'assets.darkLogo': null,
  'assets.favicon': null,
  'assets.background': null,
};

describe('a slot’s actions', () => {
  it('name each slot’s actions for the screen reader', () => {
    const view = slotView('logo', {
      ...none,
      'assets.logo': { assetId: 'abcdef012345', alt: 'A' },
    });
    expect(view).toMatchObject({
      uploadName: 'Replace logo',
      deleteName: 'Delete image: logo',
      note: 'An image is set (abcdef01).',
      alt: 'A',
    });
    expect(slotView('favicon', none)).toMatchObject({ uploadName: 'Upload favicon', alt: null });
  });
});

describe('the thumbnail of an uploaded image', () => {
  it('is a data address for a PNG, a JPEG or a WebP, whatever the case of its type', () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff]);
    expect(imageDataUrl(bytes, 'image/png')).toBe('data:image/png;base64,iVBOR/8=');
    expect(imageDataUrl(bytes, 'Image/JPEG; charset=x')).toBe('data:image/jpeg;base64,iVBOR/8=');
    expect(imageDataUrl(bytes, 'image/webp')).toMatch(/^data:image\/webp;base64,/u);
  });

  it('is nothing for any other type, since a data address carries whatever it is given', () => {
    const bytes = new Uint8Array([1]);
    for (const type of ['image/svg+xml', 'text/html', 'application/octet-stream', '', null]) {
      expect(imageDataUrl(bytes, type), String(type)).toBeNull();
    }
  });

  it('encodes a whole image without running out of stack', () => {
    const big = new Uint8Array(1_300_000).fill(7);
    expect(imageDataUrl(big, 'image/png')?.length).toBeGreaterThan(1_700_000);
  });

  it('is asked of the image each slot holds, and of none for an empty one', () => {
    expect(
      slotAssetIds({
        ...none,
        'assets.logo': { assetId: 'a', alt: 'A' },
        'assets.background': { assetId: 'b' },
      }),
    ).toEqual({
      logo: { id: 'a', asked: true },
      darkLogo: { id: '', asked: false },
      favicon: { id: '', asked: false },
      background: { id: 'b', asked: true },
    });
  });

  it('is nothing for an empty slot, whatever its read says, and the read for a held one', () => {
    const loading = { status: 'loading' } as const;
    expect(slotThumbnail(false, loading)).toEqual({ status: 'none' });
    expect(slotThumbnail(true, loading)).toEqual(loading);
    const ready = { status: 'ready', data: 'data:image/png;base64,AA==' } as const;
    expect(slotThumbnail(true, ready)).toEqual(ready);
  });

  it('says what it shows from the logo’s alt text, else from the slot', () => {
    expect(thumbnailAlt('logo', 'Acme')).toBe('Acme');
    expect(thumbnailAlt('logo', '  ')).toBe('Logo');
    expect(thumbnailAlt('favicon', null)).toBe('Favicon');
    expect(thumbnailAlt('background', null)).toBe('Background image');
  });
});
