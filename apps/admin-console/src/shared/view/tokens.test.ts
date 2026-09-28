import { describe, expect, it } from 'vitest';
import tokens from '#/shared/view/tokens.css?raw';

// jsdom resolves no light-dark(), so the pairs are read from the source and
// measured here with the WCAG 2.2 relative-luminance formula.

type Theme = 'light' | 'dark';

function colours(): Map<string, Record<Theme, string>> {
  const found = new Map<string, Record<Theme, string>>();
  const pattern = /(--[a-z0-9-]+):\s*light-dark\(\s*(#[0-9a-f]{6})\s*,\s*(#[0-9a-f]{6})\s*\)/giu;
  for (const [, name, light, dark] of tokens.matchAll(pattern)) {
    if (name !== undefined && light !== undefined && dark !== undefined) {
      found.set(name, { light, dark });
    }
  }
  return found;
}

function luminance(hex: string): number {
  const channel = (offset: number): number => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

const SIGNALS = ['active', 'warning', 'danger', 'system'] as const;
const PANELS = ['--surface-panel', '--surface-page', '--surface-sunken'] as const;

const TEXT_PAIRS: readonly (readonly [ink: string, surface: string])[] = [
  ...PANELS.flatMap((surface) => [
    ['--ink-primary', surface] as const,
    ['--ink-muted', surface] as const,
  ]),
  ['--ink-rail', '--surface-rail'],
  ['--ink-rail', '--surface-rail-raised'],
  ['--ink-rail-muted', '--surface-rail'],
  ['--surface-panel', '--signal-active-ink'],
  ...SIGNALS.flatMap((signal) => [
    [`--signal-${signal}-ink`, `--signal-${signal}`] as const,
    ...PANELS.map((surface) => [`--signal-${signal}-ink`, surface] as const),
  ]),
];

const THEMES: readonly Theme[] = ['light', 'dark'];

describe("Instrument's tokens", () => {
  const palette = colours();

  it('declares every colour it pairs, in both themes, as light-dark() hex', () => {
    const named = new Set(TEXT_PAIRS.flat());
    expect([...named].filter((name) => !palette.has(name))).toEqual([]);
  });

  it.each(THEMES)('reaches 4.5:1 for every ink on its surface in the %s theme', (theme) => {
    const failing = TEXT_PAIRS.flatMap(([ink, surface]) => {
      const fg = palette.get(ink)?.[theme];
      const bg = palette.get(surface)?.[theme];
      if (fg === undefined || bg === undefined) return [`${ink} on ${surface}: undeclared`];
      const ratio = contrast(fg, bg);
      return ratio >= 4.5 ? [] : [`${ink} on ${surface}: ${ratio.toFixed(2)}`];
    });
    expect(failing).toEqual([]);
  });

  it.each(THEMES)('draws focus at 3:1 against every surface in the %s theme', (theme) => {
    const focus = palette.get('--focus-ring')?.[theme];
    expect(focus).toBeDefined();
    const failing = [...PANELS, '--surface-rail'].filter((surface) => {
      const bg = palette.get(surface)?.[theme];
      return focus === undefined || bg === undefined || contrast(focus, bg) < 3;
    });
    expect(failing).toEqual([]);
  });

  it('holds the scale, space, shape and motion the design names', () => {
    const value = (name: string): string | undefined =>
      new RegExp(`${name}:\\s*([^;]+);`, 'u').exec(tokens)?.[1]?.trim();
    expect([12, 13, 15, 20, 28].map((n) => value(`--type-${String(n)}`))).toEqual([
      '12px',
      '13px',
      '15px',
      '20px',
      '28px',
    ]);
    expect([1, 2, 3, 4, 6, 8].map((n) => value(`--space-${String(n)}`))).toEqual([
      '4px',
      '8px',
      '12px',
      '16px',
      '24px',
      '32px',
    ]);
    expect([value('--radius-s'), value('--radius-m')]).toEqual(['3px', '4px']);
    expect([value('--motion-fast'), value('--motion-panel')]).toEqual(['120ms', '200ms']);
    expect(tokens).toMatch(/prefers-reduced-motion:\s*reduce[^}]*--motion-fast:\s*0ms/su);
  });
});
