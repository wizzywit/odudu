import { counted } from '#/shared/service/format';
import type { ColourValues } from '#/features/branding/service/values';
import {
  isHexColour,
  PALETTE_LABELS,
  SCHEME_LABELS,
  type Palette,
  type PaletteKey,
  type Scheme,
} from '#/features/branding/service/palette';

const TEXT = 4.5;
const UI = 3;

export interface Pair {
  foreground: PaletteKey;
  background: PaletteKey;
  required: number;
}

// The pairs the server holds a palette to at publish, written out the same
// way: text at 4.5:1, borders and the focus ring at 3:1. A test holds this
// list to the server's verdicts. The server is the authority; this only
// shows the result before a publish is tried.
export const PAIRS: readonly Pair[] = [
  { foreground: 'inkPrimary', background: 'surfacePage', required: TEXT },
  { foreground: 'inkPrimary', background: 'surfacePanel', required: TEXT },
  { foreground: 'inkMuted', background: 'surfacePage', required: TEXT },
  { foreground: 'inkMuted', background: 'surfacePanel', required: TEXT },
  { foreground: 'inkPrimary', background: 'surfaceSunken', required: TEXT },
  { foreground: 'inkMuted', background: 'surfaceSunken', required: TEXT },
  { foreground: 'signalActiveInk', background: 'surfacePage', required: TEXT },
  { foreground: 'signalActiveInk', background: 'surfacePanel', required: TEXT },
  { foreground: 'signalActiveInk', background: 'signalActive', required: TEXT },
  { foreground: 'signalActiveInk', background: 'surfaceSunken', required: TEXT },
  { foreground: 'signalDangerInk', background: 'signalDanger', required: TEXT },
  { foreground: 'borderStrong', background: 'surfacePanel', required: UI },
  { foreground: 'borderStrong', background: 'surfaceSunken', required: UI },
  { foreground: 'signalDangerInk', background: 'surfacePanel', required: UI },
  { foreground: 'signalDangerInk', background: 'surfaceSunken', required: UI },
  { foreground: 'focusRing', background: 'surfacePage', required: UI },
  { foreground: 'focusRing', background: 'surfacePanel', required: UI },
  { foreground: 'focusRing', background: 'surfaceSunken', required: UI },
];

function channel(hex: string, offset: number): number {
  const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

export function contrastRatio(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

export interface PairRow {
  id: string;
  scheme: Scheme;
  // "Muted text on panel".
  name: string;
  // Null while one of the two colours is not a finished #rrggbb.
  ratio: number | null;
  required: number;
  passes: boolean;
}

export function pairName(pair: Pair): string {
  const text = `${PALETTE_LABELS[pair.foreground].short} on ${PALETTE_LABELS[pair.background].short}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// A pair with a colour not yet finished cannot pass, and says why in place
// of a ratio.
function rowOf(scheme: Scheme, palette: Palette, pair: Pair): PairRow {
  const ready = isHexColour(palette[pair.foreground]) && isHexColour(palette[pair.background]);
  const ratio = ready ? contrastRatio(palette[pair.foreground], palette[pair.background]) : null;
  return {
    id: `${scheme}:${pair.foreground}/${pair.background}`,
    scheme,
    name: pairName(pair),
    ratio,
    required: pair.required,
    passes: ratio !== null && ratio >= pair.required,
  };
}

// The eighteen pairs of a palette; a scheme left to Instrument has none to show.
export function pairRows(scheme: Scheme, palette: Palette | null): readonly PairRow[] {
  return palette === null ? [] : PAIRS.map((pair) => rowOf(scheme, palette, pair));
}

export function failingRows(rows: readonly PairRow[]): readonly PairRow[] {
  return rows.filter((row) => !row.passes);
}

export function ratioText(ratio: number | null): string {
  return ratio === null ? 'Not a colour yet' : `${ratio.toFixed(1)}:1`;
}

// The ratio below which it fails is the required one, shown as a floor.
export function requirementText(required: number): string {
  return `needs ${required.toFixed(1)}:1`;
}

export function rowText(row: PairRow): string {
  return `${SCHEME_LABELS[row.scheme]}: ${row.name}, ${ratioText(row.ratio)}, ${requirementText(row.required)}`;
}

export function contrastSummary(failing: readonly PairRow[], shown: number): string {
  if (shown === 0) return 'Instrument’s own colours are used, and they meet every requirement.';
  if (failing.length === 0) return `All ${counted(shown, 'pair', 'pairs')} meet their requirement.`;
  return `${counted(failing.length, 'pair fails', 'pairs fail')} its requirement.`;
}

// Why Publish is held, naming the first pair that fails.
export function contrastHold(failing: readonly PairRow[]): string | undefined {
  const first = failing[0];
  if (first === undefined) return undefined;
  const more = failing.length - 1;
  return `Fix the contrast before publishing: ${rowText(first)}${more > 0 ? `, and ${counted(more, 'more pair', 'more pairs')}` : ''}.`;
}

export const CONTRAST_PASSES = 'Contrast passes.';
export const CONTRAST_FAILS = 'Contrast fails: see the pairs listed.';

export interface ContrastReport {
  rows: readonly PairRow[];
  failing: readonly PairRow[];
  summary: string;
  // The short word a screen reader is told, which changes only when the
  // answer does and not with each colour typed.
  verdict: string;
  hold: string | undefined;
}

// The pairs of every palette being edited, as they stand on screen.
export function contrastReport(values: ColourValues): ContrastReport {
  const rows = [
    ...pairRows('light', values['tokens.light']),
    ...pairRows('dark', values['tokens.dark']),
  ];
  const failing = failingRows(rows);
  return {
    rows,
    failing,
    summary: contrastSummary(failing, rows.length),
    verdict: failing.length > 0 ? CONTRAST_FAILS : CONTRAST_PASSES,
    hold: contrastHold(failing),
  };
}
