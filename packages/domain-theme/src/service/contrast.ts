import { type Palette, type TokenGroups } from '#/service/body';

export const TEXT_CONTRAST = 4.5;
export const UI_CONTRAST = 3;

type ColourKey = keyof Palette;

interface Pair {
  foreground: ColourKey;
  background: ColourKey;
  required: number;
}

// Text pairs hold 4.5:1; the border and focus ring are UI components, held
// to 3:1. Each pair is a foreground and background some rule in the server
// pages' stylesheet puts together.
const PAIRS: readonly Pair[] = [
  { foreground: 'inkPrimary', background: 'surfacePage', required: TEXT_CONTRAST },
  { foreground: 'inkPrimary', background: 'surfacePanel', required: TEXT_CONTRAST },
  { foreground: 'inkMuted', background: 'surfacePage', required: TEXT_CONTRAST },
  { foreground: 'inkMuted', background: 'surfacePanel', required: TEXT_CONTRAST },
  { foreground: 'inkPrimary', background: 'surfaceSunken', required: TEXT_CONTRAST },
  { foreground: 'inkMuted', background: 'surfaceSunken', required: TEXT_CONTRAST },
  { foreground: 'signalActiveInk', background: 'surfacePage', required: TEXT_CONTRAST },
  { foreground: 'signalActiveInk', background: 'surfacePanel', required: TEXT_CONTRAST },
  { foreground: 'signalActiveInk', background: 'signalActive', required: TEXT_CONTRAST },
  { foreground: 'signalActiveInk', background: 'surfaceSunken', required: TEXT_CONTRAST },
  { foreground: 'signalDangerInk', background: 'signalDanger', required: TEXT_CONTRAST },
  { foreground: 'borderStrong', background: 'surfacePanel', required: UI_CONTRAST },
  { foreground: 'borderStrong', background: 'surfaceSunken', required: UI_CONTRAST },
  { foreground: 'signalDangerInk', background: 'surfacePanel', required: UI_CONTRAST },
  { foreground: 'signalDangerInk', background: 'surfaceSunken', required: UI_CONTRAST },
  { foreground: 'focusRing', background: 'surfacePage', required: UI_CONTRAST },
  { foreground: 'focusRing', background: 'surfacePanel', required: UI_CONTRAST },
  { foreground: 'focusRing', background: 'surfaceSunken', required: UI_CONTRAST },
];

export interface ContrastFailure {
  scheme: 'light' | 'dark';
  // `foreground/background`, by palette key.
  pair: string;
  ratio: number;
  required: number;
}

// 0.03928 is the constant WCAG publishes; the corrected 0.04045 gives the
// same ratios for 8-bit channels.
function channel(hex: string, offset: number): number {
  const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

// WCAG 2.2 relative-luminance contrast of two `#rrggbb` colours.
export function contrastRatio(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export function contrastFailures(tokens: TokenGroups): ContrastFailure[] {
  const failures: ContrastFailure[] = [];
  for (const scheme of ['light', 'dark'] as const) {
    const palette = tokens[scheme];
    if (palette === undefined) continue;
    for (const { foreground, background, required } of PAIRS) {
      const ratio = contrastRatio(palette[foreground], palette[background]);
      if (ratio < required) {
        failures.push({ scheme, pair: `${foreground}/${background}`, ratio, required });
      }
    }
  }
  return failures;
}
