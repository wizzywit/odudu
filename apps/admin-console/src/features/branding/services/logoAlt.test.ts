import { describe, expect, it } from 'vitest';
import {
  altEdited,
  altProblem,
  imagesHold,
  altChanged,
} from '#/features/branding/services/logoAlt';
import type { ImageValues } from '#/features/branding/services/imageValues';

const none: ImageValues = {
  'assets.logo': null,
  'assets.darkLogo': null,
  'assets.favicon': null,
  'assets.background': null,
};

describe('logos', () => {
  it('require alt text of at most 200 characters', () => {
    expect(altProblem('')).toBe('Describe the logo; it is required.');
    expect(altProblem('x'.repeat(201))).toMatch(/200 characters/u);
    expect(altProblem('Acme')).toBeUndefined();
  });

  it('hold Save until each logo has alt text', () => {
    expect(imagesHold(none)).toBeUndefined();
    expect(imagesHold({ ...none, 'assets.darkLogo': { assetId: 'a', alt: '' } })).toMatch(
      /alt text is required/u,
    );
    expect(altEdited(none, 'logo', 'x')).toBeNull();
  });
});

describe('an alt text marked changed', () => {
  it('is a logo’s alt text that differs from the saved one', () => {
    const saved = { ...none, 'assets.logo': { assetId: 'a', alt: 'A' } };
    const edited = { ...none, 'assets.logo': { assetId: 'a', alt: 'B' } };
    expect(altChanged(saved, edited, 'logo')).toBe(true);
    expect(altChanged(saved, saved, 'logo')).toBe(false);
    expect(altChanged(saved, saved, 'favicon')).toBe(false);
  });
});
