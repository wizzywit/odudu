import { describe, expect, it } from 'vitest';
import { sameColours } from '#/service/mail-preview';

const COLOURS = {
  page: '#ffffff',
  panel: '#fafafa',
  sunken: '#f0f0f0',
  border: '#777777',
  ink: '#111111',
  muted: '#555555',
  link: '#004400',
  button: '#ddeedd',
  buttonInk: '#004400',
};

describe('sameColours', () => {
  it('compares two palettes of the same values equal whatever order the keys were written in', () => {
    const reordered = {
      buttonInk: COLOURS.buttonInk,
      button: COLOURS.button,
      link: COLOURS.link,
      muted: COLOURS.muted,
      ink: COLOURS.ink,
      border: COLOURS.border,
      sunken: COLOURS.sunken,
      panel: COLOURS.panel,
      page: COLOURS.page,
    };
    expect(sameColours(COLOURS, reordered)).toBe(true);
  });

  it('tells a palette with one role changed from another', () => {
    expect(sameColours(COLOURS, { ...COLOURS, panel: '#e0f0ff' })).toBe(false);
  });

  it('treats a missing palette as equal to a missing one and unequal to a set one', () => {
    expect(sameColours(null, undefined)).toBe(true);
    expect(sameColours(COLOURS, null)).toBe(false);
    expect(sameColours(undefined, COLOURS)).toBe(false);
  });
});
