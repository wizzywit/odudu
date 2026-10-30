import { describe, expect, it } from 'vitest';
import {
  altEdited,
  altProblem,
  imageAfterUpload,
  imageDataUrl,
  imagesHold,
  inUse,
  inUseTitle,
  limitText,
  slotAssetIds,
  slotThumbnail,
  slotView,
  thumbnailAlt,
  uploadFailureOf,
  uploadFailureText,
  uploadRefusal,
  type ImageValues,
} from '#/features/branding/service';

const none: ImageValues = {
  'assets.logo': null,
  'assets.darkLogo': null,
  'assets.favicon': null,
  'assets.background': null,
};

const problemOf = (type: string, status = 422, extra = {}) => ({
  type: `about:blank#${type}`,
  title: 'Refused',
  status,
  ...extra,
});

describe('limits', () => {
  it('state the size and side of each kind', () => {
    expect(limitText('logo')).toContain('up to 256 KiB and 1024 pixels');
    expect(limitText('background')).toContain('up to 1 MiB and 2560 pixels');
  });

  it('refuse a file over its size or of another type before it is sent', () => {
    expect(uploadRefusal('logo', { type: 'image/gif', size: 1 })).toBe(
      'That is not a PNG, a JPEG or a WebP.',
    );
    expect(uploadRefusal('favicon', { type: 'image/png', size: 300 * 1024 })).toMatch(
      /over 256 KiB/u,
    );
    expect(uploadRefusal('background', { type: 'image/webp', size: 300 * 1024 })).toBeNull();
    expect(uploadRefusal('logo', { type: '', size: 10 })).toBeNull();
  });
});

describe('a refused upload', () => {
  it('says 413 as too large even with no problem type', () => {
    expect(uploadFailureText('background', problemOf('', 413))).toMatch(/over 1 MiB/u);
  });

  it('says anything unknown in general terms, never the server’s detail', () => {
    expect(uploadFailureText('logo', problemOf('mystery', 500, { detail: 'decoder: x' }))).toBe(
      'The image was not uploaded.',
    );
  });

  it('distinguishes a lost answer from the console’s own fault', () => {
    expect(uploadFailureOf('logo', { ok: false, kind: 'network' })).toMatch(/Could not confirm/u);
    expect(uploadFailureOf('logo', { ok: false, kind: 'defect' })).toMatch(/fault in the console/u);
  });
});

describe('an image still in use', () => {
  const found = inUse(
    problemOf('asset-in-use', 409, {
      detail: 'a theme still names the image, more than errors lists',
      errors: [{ path: 'theme', message: 'named by the draft d' }],
    }),
  );

  it('lists the themes by path, and says when there are more', () => {
    expect(found?.lines).toEqual(['This tenant’s theme: named by the draft d.']);
    expect(found?.more).toBe(true);
    expect(found === null ? '' : inUseTitle(found)).toMatch(/still used by 1 theme or more/u);
  });

  it('is nothing for another problem', () => {
    expect(inUse(problemOf('asset-cap', 409))).toBeNull();
  });
});

describe('logos', () => {
  it('require alt text of at most 200 characters', () => {
    expect(altProblem('')).toBe('Describe the logo; it is required.');
    expect(altProblem('x'.repeat(201))).toMatch(/200 characters/u);
    expect(altProblem('Acme')).toBeUndefined();
  });

  it('start without alt text on first upload and keep it on replacement', () => {
    expect(imageAfterUpload('logo', 'a', none)).toEqual({ assetId: 'a', alt: '' });
    const had = { ...none, 'assets.logo': { assetId: 'old', alt: 'Acme' } };
    expect(imageAfterUpload('logo', 'new', had)).toEqual({ assetId: 'new', alt: 'Acme' });
    expect(imageAfterUpload('favicon', 'f', had)).toEqual({ assetId: 'f' });
  });

  it('hold Save until each logo has alt text', () => {
    expect(imagesHold(none)).toBeUndefined();
    expect(imagesHold({ ...none, 'assets.darkLogo': { assetId: 'a', alt: '' } })).toMatch(
      /alt text is required/u,
    );
    expect(altEdited(none, 'logo', 'x')).toBeNull();
  });

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
