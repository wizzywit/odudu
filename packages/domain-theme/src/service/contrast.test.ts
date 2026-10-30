import { describe, expect, it } from 'vitest';

import { contrastFailures, contrastRatio } from '#/service/contrast';
import { type Palette } from '#/service/body';

const PASSING: Palette = {
  surfacePage: '#ffffff',
  surfacePanel: '#ffffff',
  surfaceSunken: '#ffffff',
  inkPrimary: '#000000',
  inkMuted: '#767676',
  signalActive: '#ffffff',
  signalActiveInk: '#000000',
  signalDanger: '#ffffff',
  signalDangerInk: '#000000',
  borderStrong: '#949494',
  focusRing: '#949494',
};

describe('contrastRatio', () => {
  it('is 21 for black on white and 1 for identical colours', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBe(21);
    expect(contrastRatio('#336699', '#336699')).toBe(1);
  });

  it('does not depend on which colour is the foreground', () => {
    expect(contrastRatio('#767676', '#ffffff')).toBe(contrastRatio('#ffffff', '#767676'));
  });

  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
    expect(contrastRatio('#787878', '#ffffff')).toBeCloseTo(4.42, 2);
    expect(contrastRatio('#949494', '#ffffff')).toBeCloseTo(3.03, 2);
    expect(contrastRatio('#979797', '#ffffff')).toBeCloseTo(2.92, 2);
  });

  it('puts two colours either side of 4.5:1 on their own sides', () => {
    expect(contrastRatio('#757589', '#ffffff')).toBeCloseTo(4.504, 3);
    expect(contrastRatio('#75758a', '#ffffff')).toBeCloseTo(4.499, 3);
    const palette = (ink: string): Palette => ({ ...PASSING, inkMuted: ink });
    expect(contrastFailures({ light: palette('#757589') })).toEqual([]);
    expect(contrastFailures({ light: palette('#75758a') })).toHaveLength(3);
  });
});

describe('contrastFailures', () => {
  it('passes a palette whose pairs all meet their threshold', () => {
    expect(contrastFailures({ light: PASSING, dark: PASSING })).toEqual([]);
  });

  it('[ODUDU-THEME-CONTRAST-01] flags a 4.4:1 text pair and passes 4.5:1', () => {
    const failing = contrastFailures({ light: { ...PASSING, inkMuted: '#787878' } });
    expect(failing).toHaveLength(3);
    expect(failing.map((f) => f.pair)).toEqual([
      'inkMuted/surfacePage',
      'inkMuted/surfacePanel',
      'inkMuted/surfaceSunken',
    ]);
    expect(failing[0]).toMatchObject({ scheme: 'light', required: 4.5 });
    expect(failing[0]?.ratio).toBeCloseTo(4.42, 2);
    expect(contrastFailures({ light: PASSING })).toEqual([]);
  });

  it('[ODUDU-THEME-CONTRAST-02] flags a 2.9:1 focus ring and passes 3:1', () => {
    const failing = contrastFailures({ dark: { ...PASSING, focusRing: '#979797' } });
    expect(failing.map((f) => f.pair)).toEqual([
      'focusRing/surfacePage',
      'focusRing/surfacePanel',
      'focusRing/surfaceSunken',
    ]);
    expect(failing[0]).toMatchObject({ scheme: 'dark', required: 3 });
    expect(failing[0]?.ratio).toBeCloseTo(2.92, 2);
    expect(contrastFailures({ dark: { ...PASSING, focusRing: '#949494' } })).toEqual([]);
  });

  it('holds the border to 3:1 and the primary action to 4.5:1', () => {
    const failing = contrastFailures({
      light: {
        ...PASSING,
        borderStrong: '#cccccc',
        signalActive: '#777777',
        signalActiveInk: '#ffffff',
      },
    });
    expect(failing.map((f) => [f.pair, f.required])).toEqual([
      ['signalActiveInk/surfacePage', 4.5],
      ['signalActiveInk/surfacePanel', 4.5],
      ['signalActiveInk/signalActive', 4.5],
      ['signalActiveInk/surfaceSunken', 4.5],
      ['borderStrong/surfacePanel', 3],
      ['borderStrong/surfaceSunken', 3],
    ]);
  });

  it('flags a link colour that fails on the panel and passes one that does not', () => {
    const link = (ink: string): Palette => ({
      ...PASSING,
      signalActiveInk: ink,
      signalActive: '#000000',
    });
    expect(contrastFailures({ light: link('#787878') }).map((f) => f.pair)).toEqual([
      'signalActiveInk/surfacePage',
      'signalActiveInk/surfacePanel',
      'signalActiveInk/surfaceSunken',
    ]);
    expect(contrastFailures({ light: link('#767676') })).toEqual([]);
  });

  it('holds the danger ink to 3:1 as a border on the panel and the input', () => {
    const failing = contrastFailures({
      light: { ...PASSING, signalDanger: '#000000', signalDangerInk: '#cccccc' },
    });
    expect(failing.map((f) => [f.pair, f.required])).toEqual([
      ['signalDangerInk/surfacePanel', 3],
      ['signalDangerInk/surfaceSunken', 3],
    ]);
  });

  it('flags a sunken pair and a danger pair', () => {
    const sunken = contrastFailures({ light: { ...PASSING, surfaceSunken: '#777777' } });
    expect(sunken.map((f) => f.pair)).toEqual([
      'inkMuted/surfaceSunken',
      'borderStrong/surfaceSunken',
      'focusRing/surfaceSunken',
    ]);
    const danger = contrastFailures({
      dark: { ...PASSING, signalDanger: '#777777', signalDangerInk: '#888888' },
    });
    expect(danger.map((f) => [f.pair, f.required])).toEqual([
      ['signalDangerInk/signalDanger', 4.5],
    ]);
  });

  it('checks only the groups that are present', () => {
    expect(contrastFailures({})).toEqual([]);
    expect(contrastFailures({ font: 'IBM Plex Mono' })).toEqual([]);
  });
});
