import { describe, expect, it } from 'vitest';
import {
  colourProblem,
  isHexColour,
  paletteProblems,
  swatchOf,
  typedColour,
  withColour,
  changedColours,
} from '#/features/branding-editor/services/colourEdits';
import { DEFAULT_PALETTES } from '#/features/branding-editor/services/palette';

describe('a colour as typed', () => {
  it('is lowercased and trimmed, and finished only as #rrggbb', () => {
    expect(typedColour('  #A0B1C2 ')).toBe('#a0b1c2');
    expect(isHexColour('#a0b1c2')).toBe(true);
    expect(isHexColour('#a0b1c')).toBe(false);
    expect(isHexColour('a0b1c2')).toBe(false);
    expect(colourProblem('#zzz')).toBe('A colour as #rrggbb.');
    expect(colourProblem('#000000')).toBeUndefined();
  });

  it('shows black in the picker until it is finished', () => {
    expect(swatchOf('#1')).toBe('#000000');
    expect(swatchOf('#123456')).toBe('#123456');
  });

  it('changes one colour of a palette and leaves the rest', () => {
    const changed = withColour(DEFAULT_PALETTES.light, 'inkPrimary', '#000000');
    expect(changed.inkPrimary).toBe('#000000');
    expect(changed.surfacePage).toBe(DEFAULT_PALETTES.light.surfacePage);
    expect(paletteProblems({ ...changed, focusRing: '#1' })).toEqual(['focusRing']);
    expect(paletteProblems(null)).toEqual([]);
  });
});

describe('a colour marked changed', () => {
  it('is each colour that differs from the saved palette, none for a scheme left alone', () => {
    const now = { ...DEFAULT_PALETTES.light, inkPrimary: '#000000' };
    expect(changedColours(DEFAULT_PALETTES.light, now)).toEqual(['inkPrimary']);
    expect(changedColours(null, null)).toEqual([]);
    expect(changedColours(null, now)).toHaveLength(11);
  });
});
