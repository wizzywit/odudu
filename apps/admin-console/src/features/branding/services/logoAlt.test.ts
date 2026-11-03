import { describe, expect, it } from 'vitest';
import { altEdited, altProblem, imagesHold } from '#/features/branding/services/logoAlt';
import type { ImageValues } from '#/features/branding/services/values';

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
