import { describe, expect, it } from 'vitest';
import tokens from '#/shared/view/tokens.css?raw';

// jsdom resolves no light-dark(), so the pairs are read from the source and
// measured here with the WCAG 2.2 relative-luminance formula.

type Theme = 'light' | 'dark';
type Palette = Map<string, Record<Theme, string>>;

const THEMES: readonly Theme[] = ['light', 'dark'];
const COLOUR_TOKEN = /^--(?:surface|ink|signal|border|focus|rail)(?:-|$)/u;
const LIGHT_DARK = /^light-dark\(\s*(#[0-9a-f]{6})\s*,\s*(#[0-9a-f]{6})\s*\)$/iu;

// Every colour token is declared once, as light-dark(#hex, #hex), wherever it
// sits: a second declaration or a media-scoped override is a problem, because
// the pairs measured here would no longer be the pairs a browser draws.
function readPalette(css: string): { palette: Palette; problems: string[] } {
  const source = css.replace(/\/\*[\s\S]*?\*\//gu, '');
  const palette: Palette = new Map();
  const problems: string[] = [];
  for (const [, name = '', raw = ''] of source.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;{}]+);/giu)) {
    if (!COLOUR_TOKEN.test(name)) continue;
    const value = raw.replace(/\s+/gu, ' ').trim();
    const match = LIGHT_DARK.exec(value);
    if (palette.has(name)) problems.push(`${name}: declared more than once`);
    if (match?.[1] === undefined || match[2] === undefined) {
      problems.push(`${name}: not light-dark(#hex, #hex): ${value}`);
      continue;
    }
    palette.set(name, { light: match[1].toLowerCase(), dark: match[2].toLowerCase() });
  }
  return { palette, problems };
}

// A signal is named by its surface or its ink, so losing either half leaves
// the other asking for its pair.
function signals(palette: Palette): string[] {
  const names = [...palette.keys()].flatMap(
    (name) => /^--signal-(.+?)(?:-ink)?$/u.exec(name)?.[1] ?? [],
  );
  return [...new Set(names)];
}

function channels(hex: string): [number, number, number] {
  const linear = (offset: number): number => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return [linear(1), linear(3), linear(5)];
}

function contrast(a: string, b: string): number {
  const luminance = (hex: string): number => {
    const [r, g, b] = channels(hex);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi = 0, lo = 0] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Björn Ottosson's OKLab, from linear sRGB.
function oklab(hex: string): [number, number, number] {
  const [r, g, b] = channels(hex);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function deltaE(a: string, b: string): number {
  const [p, q] = [oklab(a), oklab(b)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

const PANELS = ['--surface-panel', '--surface-page', '--surface-sunken'] as const;

function textPairs(palette: Palette): (readonly [ink: string, surface: string])[] {
  return [
    ...PANELS.flatMap((surface) => [
      ['--ink-primary', surface] as const,
      ['--ink-muted', surface] as const,
    ]),
    ['--ink-rail', '--surface-rail'],
    ['--ink-rail', '--surface-rail-raised'],
    ['--ink-rail-muted', '--surface-rail'],
    ['--surface-panel', '--signal-active-ink'],
    ['--surface-panel', '--ink-primary'],
    ...signals(palette).flatMap((signal) => [
      [`--signal-${signal}-ink`, `--signal-${signal}`] as const,
      ...PANELS.map((surface) => [`--signal-${signal}-ink`, surface] as const),
    ]),
  ];
}

const FOCUS_PAIRS: readonly (readonly [ring: string, surface: string])[] = [
  ...[...PANELS, '--surface-rail'].map((surface) => ['--focus-ring', surface] as const),
  ['--rail-accent', '--surface-rail'],
  ['--rail-accent', '--surface-rail-raised'],
];

function failures(
  palette: Palette,
  theme: Theme,
  pairs: readonly (readonly [string, string])[],
  minimum: number,
): string[] {
  return pairs.flatMap(([ink, surface]) => {
    const fg = palette.get(ink)?.[theme];
    const bg = palette.get(surface)?.[theme];
    if (fg === undefined || bg === undefined) return [`${ink} on ${surface}: undeclared`];
    const ratio = contrast(fg, bg);
    return ratio >= minimum ? [] : [`${ink} on ${surface}: ${ratio.toFixed(2)}`];
  });
}

// Amber means system authority alone, so it must read as a different colour
// from every other signal at a glance, not only side by side. 0.06 is three
// times OKLab's usual just-noticeable difference of 0.02.
const AMBER_MIN_DELTA_E = 0.06;

function amberFailures(palette: Palette): string[] {
  return THEMES.flatMap((theme) =>
    signals(palette)
      .filter((signal) => signal !== 'system')
      .flatMap((signal) =>
        ['', '-ink'].flatMap((part) => {
          const amber = palette.get(`--signal-system${part}`)?.[theme];
          const other = palette.get(`--signal-${signal}${part}`)?.[theme];
          if (amber === undefined || other === undefined) {
            return [`--signal-${signal}${part} (${theme}): undeclared`];
          }
          const distance = deltaE(amber, other);
          return distance >= AMBER_MIN_DELTA_E
            ? []
            : [`--signal-${signal}${part} (${theme}): ΔE ${distance.toFixed(3)}`];
        }),
      ),
  );
}

describe("Instrument's tokens", () => {
  const { palette, problems } = readPalette(tokens);

  it('declares every colour token once, as light-dark(#hex, #hex)', () => {
    expect(problems).toEqual([]);
    expect(signals(palette).sort()).toEqual(['active', 'danger', 'system', 'warning']);
  });

  it.each(THEMES)('reaches 4.5:1 for every ink on its surface in the %s theme', (theme) => {
    expect(failures(palette, theme, textPairs(palette), 4.5)).toEqual([]);
  });

  it.each(THEMES)('draws focus at 3:1 against every surface in the %s theme', (theme) => {
    expect(failures(palette, theme, FOCUS_PAIRS, 3)).toEqual([]);
  });

  it('keeps amber apart from every other signal', () => {
    expect(amberFailures(palette)).toEqual([]);
  });

  it('holds the scale, space, shape and motion the design names', () => {
    const value = (name: string, css = tokens): string | undefined =>
      new RegExp(`${name}:\\s*([^;]+);`, 'u').exec(css)?.[1]?.trim();
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
    const reduced = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\}\s*\}/u.exec(
      tokens,
    )?.[1];
    expect([value('--motion-fast', reduced), value('--motion-panel', reduced)]).toEqual([
      '0ms',
      '0ms',
    ]);
  });
});

describe('the token reader', () => {
  it('does not read a commented-out declaration', () => {
    const commented = tokens.replace(/(--signal-danger-ink:[^;]+;)/u, '/* $1 */');
    const { palette } = readPalette(commented);
    expect(palette.has('--signal-danger-ink')).toBe(false);
    expect(failures(palette, 'light', textPairs(palette), 4.5)).toContain(
      '--signal-danger-ink on --signal-danger: undeclared',
    );
  });

  it('refuses a token declared twice, or overridden in another form', () => {
    const { problems } = readPalette(
      `${tokens}\n@media (forced-colors: active) { :root { --ink-muted: #999999; } }`,
    );
    expect(problems).toEqual([
      '--ink-muted: declared more than once',
      '--ink-muted: not light-dark(#hex, #hex): #999999',
    ]);
    const twice = readPalette(`${tokens}\n:root { --ink-muted: light-dark(#ffffff, #ffffff); }`);
    expect(twice.problems).toEqual(['--ink-muted: declared more than once']);
  });

  it('measures a signal it has not been told about', () => {
    const { palette } = readPalette(
      `${tokens}\n:root { --signal-info: light-dark(#eeeeee, #111111); ` +
        '--signal-info-ink: light-dark(#cccccc, #333333); }',
    );
    expect(signals(palette)).toContain('info');
    expect(failures(palette, 'light', textPairs(palette), 4.5)).toContainEqual(
      expect.stringMatching(/^--signal-info-ink on --signal-info: 1\.\d\d$/u),
    );
  });

  it('finds amber too close to an ochre that shares its hue', () => {
    const { palette } = readPalette(
      tokens
        .replace(/--signal-warning:[^;]+;/u, '--signal-warning: light-dark(#f5ebcf, #3b3013);')
        .replace(
          /--signal-warning-ink:[^;]+;/u,
          '--signal-warning-ink: light-dark(#735000, #e6bd5c);',
        ),
    );
    expect(amberFailures(palette)).toEqual([
      '--signal-warning (dark): ΔE 0.045',
      '--signal-warning-ink (dark): ΔE 0.042',
    ]);
  });
});
