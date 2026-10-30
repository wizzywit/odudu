import { describe, expect, it } from 'vitest';
import {
  contrastHold,
  contrastRatio,
  contrastReport,
  DEFAULT_PALETTES,
  PAIRS,
  pairRows,
  ratioText,
  type ColourValues,
} from '#/features/branding/service';

const values = (light: ColourValues['tokens.light'], dark: ColourValues['tokens.dark'] = null) =>
  ({ 'tokens.light': light, 'tokens.dark': dark, 'tokens.font': null }) satisfies ColourValues;

describe('contrastRatio', () => {
  it('is 21:1 for black on white and 1:1 for a colour on itself', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#336699', '#336699')).toBeCloseTo(1, 5);
  });
});

describe('the pairs', () => {
  it('are eighteen, text at 4.5 and borders and the ring at 3', () => {
    expect(PAIRS).toHaveLength(18);
    expect(PAIRS.filter((pair) => pair.required === 4.5)).toHaveLength(11);
    expect(PAIRS.filter((pair) => pair.required === 3)).toHaveLength(7);
  });

  it('all pass in the palettes customising starts from', () => {
    for (const scheme of ['light', 'dark'] as const) {
      expect(pairRows(scheme, DEFAULT_PALETTES[scheme]).every((row) => row.passes)).toBe(true);
    }
  });

  it('are none for a scheme left to Instrument', () => {
    expect(pairRows('light', null)).toEqual([]);
  });

  it('cannot pass while a colour is not finished', () => {
    const rows = pairRows('light', { ...DEFAULT_PALETTES.light, inkPrimary: '#12' });
    const unfinished = rows.filter((row) => row.ratio === null);
    expect(unfinished.length).toBeGreaterThan(0);
    expect(unfinished.every((row) => !row.passes)).toBe(true);
    expect(ratioText(null)).toBe('Not a colour yet');
  });
});

describe('contrastReport', () => {
  it('names the first failing pair and counts the rest', () => {
    const report = contrastReport(
      values({ ...DEFAULT_PALETTES.light, inkPrimary: '#e8e8e8', inkMuted: '#eeeeee' }),
    );
    expect(report.failing.length).toBeGreaterThan(1);
    expect(report.hold).toMatch(/^Fix the contrast before publishing: Light: Text on page, /u);
    expect(report.hold).toMatch(/and \d+ more pairs\.$/u);
    expect(report.summary).toMatch(/pairs fail its requirement\./u);
  });

  it('holds nothing and says so when every pair passes', () => {
    const report = contrastReport(values(DEFAULT_PALETTES.light, DEFAULT_PALETTES.dark));
    expect(report.hold).toBeUndefined();
    expect(report.summary).toBe('All 36 pairs meet their requirement.');
    expect(contrastHold([])).toBeUndefined();
  });
});
