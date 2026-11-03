import { describe, expect, it } from 'vitest';
import {
  colourFields,
  COLOURS_TITLE,
  paletteFoldOpen,
} from '#/features/branding-editor/services/colourSection';
import { DEFAULT_PALETTES } from '#/features/branding-editor/services/palette';

const NONE = { 'tokens.light': null, 'tokens.dark': null, 'tokens.font': null } as const;

describe('a palette’s fold', () => {
  it('is open when it was opened, or while a problem would be hidden by closing it', () => {
    expect(paletteFoldOpen(false, undefined, {})).toBe(false);
    expect(paletteFoldOpen(true, undefined, {})).toBe(true);
    expect(paletteFoldOpen(false, 'Refused.', {})).toBe(true);
    expect(paletteFoldOpen(false, undefined, { inkPrimary: 'A colour as #rrggbb.' })).toBe(true);
  });
});

describe('the colours section', () => {
  it('is titled for the colours and the font', () => {
    expect(COLOURS_TITLE).toBe('Colours and font');
  });

  it('says a palette is Instrument’s own or custom, and the font by its own label', () => {
    const fields = colourFields({ ...NONE, 'tokens.dark': DEFAULT_PALETTES.dark });
    expect(fields['tokens.light'].describe?.(null)).toBe('Instrument’s own colours');
    expect(fields['tokens.dark'].describe?.(DEFAULT_PALETTES.dark)).toBe('custom colours');
    expect(fields['tokens.font'].label).toBe('Font');
  });
});
