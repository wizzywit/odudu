import { describe, expect, it } from 'vitest';
import { imageAfterUpload, uploadFailureOf } from '#/features/branding/services/edits';
import type { ImageValues } from '#/features/branding/services/values';

const none: ImageValues = {
  'assets.logo': null,
  'assets.darkLogo': null,
  'assets.favicon': null,
  'assets.background': null,
};

describe('a lost upload', () => {
  it('distinguishes a lost answer from the console’s own fault', () => {
    expect(uploadFailureOf('logo', { ok: false, kind: 'network' })).toMatch(/Could not confirm/u);
    expect(uploadFailureOf('logo', { ok: false, kind: 'defect' })).toMatch(/fault in the console/u);
  });
});

describe('a logo’s alt text on upload', () => {
  it('start without alt text on first upload and keep it on replacement', () => {
    expect(imageAfterUpload('logo', 'a', none)).toEqual({ assetId: 'a', alt: '' });
    const had = { ...none, 'assets.logo': { assetId: 'old', alt: 'Acme' } };
    expect(imageAfterUpload('logo', 'new', had)).toEqual({ assetId: 'new', alt: 'Acme' });
    expect(imageAfterUpload('favicon', 'f', had)).toEqual({ assetId: 'f' });
  });
});
