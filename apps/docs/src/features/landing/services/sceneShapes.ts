import type { Box, Point } from '@site/src/features/landing/services/sceneLayouts';

// The pieces the scene is drawn from: what a window shows, the lamps in its
// title bar and the chips on the hub.

export type ShapeClass = 'bar' | 'field' | 'cta' | 'avatar' | 'block';

export interface Shape {
  // A circle, with `radius` and its centre at (x, y); otherwise a rectangle.
  round: boolean;
  look: ShapeClass;
  x: number;
  y: number;
  width?: number;
  height?: number;
  radius: number;
}

// What a window shows: a form for the browser, a page for an app.
export function skeleton(box: Box, top: number, kind: 'form' | 'app'): Shape[] {
  const x = box.x + 16;
  const w = box.w - 32;
  if (kind === 'form') {
    return [
      { round: false, look: 'bar', x, y: top, width: w * 0.34, height: 7, radius: 3.5 },
      { round: false, look: 'field', x, y: top + 14, width: w, height: 24, radius: 8 },
      { round: false, look: 'bar', x, y: top + 52, width: w * 0.42, height: 7, radius: 3.5 },
      { round: false, look: 'field', x, y: top + 66, width: w, height: 24, radius: 8 },
      { round: false, look: 'cta', x, y: top + 106, width: w * 0.5, height: 26, radius: 9 },
    ];
  }
  const block = Math.min(box.h * 0.2, 26);
  return [
    { round: true, look: 'avatar', x: x + 9, y: top + 9, radius: 9 },
    { round: false, look: 'bar', x: x + 26, y: top + 2, width: w * 0.5, height: 7, radius: 3.5 },
    { round: false, look: 'bar', x: x + 26, y: top + 13, width: w * 0.3, height: 6, radius: 3 },
    { round: false, look: 'block', x, y: top + 28, width: w, height: block, radius: 8 },
    {
      round: false,
      look: 'bar',
      x,
      y: top + 28 + block + 10,
      width: w * 0.72,
      height: 7,
      radius: 3.5,
    },
  ];
}

// The three lamps in a window's title bar.
export function lamps(box: Box): Point[] {
  return [0, 1, 2].map((index) => [box.x + 18 + index * 12, box.y + 18]);
}

export interface Chip {
  label: string;
  width: number;
  claim: string;
}

export const CHIPS: Chip[] = [
  { label: 'Password', width: 78, claim: 'passwords' },
  { label: 'Passkey', width: 68, claim: 'passkeys' },
  { label: 'Authenticator', width: 98, claim: 'authenticator-codes' },
];

const CHIP_GAP = 6;

// Where each chip starts so that the row is centred on `centre`.
export function chipStarts(centre: number): number[] {
  const total = CHIPS.reduce((sum, chip) => sum + chip.width, 0) + 2 * CHIP_GAP;
  return CHIPS.map(
    (_, index) =>
      centre -
      total / 2 +
      CHIPS.slice(0, index).reduce((sum, chip) => sum + chip.width + CHIP_GAP, 0),
  );
}

export const RING_SCALES: number[] = [0.74, 0.98, 1.22];
