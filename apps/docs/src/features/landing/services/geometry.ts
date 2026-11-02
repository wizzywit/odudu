// The sign-in scene's geometry, the paths the signals travel and which parts
// of the picture are active at each step. Pure, so a test can read it.

export type LayoutName = 'wide' | 'tall';
export type Point = [number, number];
export type RouteId = 'dh' | 'da' | 'db' | 'ha' | 'hb' | 'bh';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Route {
  points: Point[];
  // Where the arrowhead sits and which way it points, in degrees.
  head: { at: Point; angle: number };
}

export interface Layout {
  width: number;
  height: number;
  device: Box;
  hub: Box;
  appA: Box;
  appB: Box;
  routes: Record<RouteId, Route>;
}

const SAMPLES = 14;

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

// An S between two points, leaving and arriving along `axis`.
function curve(a: Point, b: Point, axis: 'h' | 'v'): Point[] {
  return Array.from({ length: SAMPLES + 1 }, (_, index) => {
    const t = index / SAMPLES;
    const eased = smooth(t);
    return axis === 'h'
      ? ([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * eased] as const)
      : ([a[0] + (b[0] - a[0]) * eased, a[1] + (b[1] - a[1]) * t] as const);
  });
}

function at(list: Point[], index: number): Point {
  const found = list[index];
  if (found === undefined) throw new Error(`no point at ${String(index)}`);
  return found;
}

// A polyline through `corners` with each corner rounded by `radius`.
function rail(corners: Point[], radius: number): Point[] {
  const out: Point[] = [at(corners, 0)];
  for (let index = 1; index < corners.length - 1; index += 1) {
    const [px, py] = at(corners, index - 1);
    const [cx, cy] = at(corners, index);
    const [nx, ny] = at(corners, index + 1);
    const before: Point = [cx - Math.sign(cx - px) * radius, cy - Math.sign(cy - py) * radius];
    const after: Point = [cx + Math.sign(nx - cx) * radius, cy + Math.sign(ny - cy) * radius];
    out.push(before);
    for (let step = 1; step < 6; step += 1) {
      const t = step / 6;
      out.push([
        (1 - t) ** 2 * before[0] + 2 * (1 - t) * t * cx + t ** 2 * after[0],
        (1 - t) ** 2 * before[1] + 2 * (1 - t) * t * cy + t ** 2 * after[1],
      ]);
    }
    out.push(after);
  }
  out.push(at(corners, corners.length - 1));
  return out;
}

const WIDE: Layout = {
  width: 960,
  height: 440,
  device: { x: 30, y: 110, w: 200, h: 220 },
  hub: { x: 340, y: 80, w: 280, h: 280 },
  appA: { x: 730, y: 36, w: 190, h: 140 },
  appB: { x: 760, y: 248, w: 190, h: 140 },
  routes: {
    dh: { points: curve([230, 220], [338, 216], 'h'), head: { at: [338, 216], angle: 0 } },
    da: {
      points: rail(
        [
          [130, 108],
          [130, 16],
          [825, 16],
          [825, 34],
        ],
        14,
      ),
      head: { at: [825, 34], angle: 90 },
    },
    db: {
      points: rail(
        [
          [130, 332],
          [130, 420],
          [855, 420],
          [855, 390],
        ],
        22,
      ),
      head: { at: [855, 390], angle: -90 },
    },
    ha: { points: curve([622, 140], [728, 106], 'h'), head: { at: [728, 106], angle: 0 } },
    hb: { points: curve([622, 300], [758, 318], 'h'), head: { at: [758, 318], angle: 0 } },
    bh: { points: curve([758, 318], [622, 300], 'h'), head: { at: [622, 300], angle: 180 } },
  },
};

const TALL: Layout = {
  width: 360,
  height: 770,
  device: { x: 80, y: 10, w: 200, h: 170 },
  hub: { x: 30, y: 250, w: 300, h: 262 },
  appA: { x: 14, y: 574, w: 150, h: 120 },
  appB: { x: 196, y: 626, w: 150, h: 120 },
  routes: {
    dh: { points: curve([180, 182], [180, 248], 'v'), head: { at: [180, 248], angle: 90 } },
    da: {
      points: rail(
        [
          [78, 95],
          [8, 95],
          [8, 634],
          [12, 634],
        ],
        20,
      ),
      head: { at: [12, 634], angle: 0 },
    },
    db: {
      points: rail(
        [
          [282, 95],
          [352, 95],
          [352, 686],
          [350, 686],
        ],
        20,
      ),
      head: { at: [350, 686], angle: 180 },
    },
    ha: { points: curve([100, 514], [89, 572], 'v'), head: { at: [89, 572], angle: 90 } },
    hb: { points: curve([260, 514], [271, 624], 'v'), head: { at: [271, 624], angle: 90 } },
    bh: { points: curve([271, 624], [260, 514], 'v'), head: { at: [260, 514], angle: -90 } },
  },
};

export const LAYOUTS: Record<LayoutName, Layout> = { wide: WIDE, tall: TALL };

export function pathData(points: Point[]): string {
  return points
    .map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join('');
}

export function keyframeName(
  layout: LayoutName,
  route: RouteId,
  kind: 'travel' | 'pass' = 'travel',
): string {
  return `${kind}-${layout}-${route}`;
}

// The ease every highlight, glide and slide of the scene shares.
export const SCENE_EASE = 'cubic-bezier(0.45, 0, 0.55, 1)';

const EASE_POINTS = { x1: 0.45, y1: 0, x2: 0.55, y2: 1 };

function bezier(parameter: number, first: number, second: number): number {
  const rest = 1 - parameter;
  return (
    3 * rest * rest * parameter * first + 3 * rest * parameter * parameter * second + parameter ** 3
  );
}

// Where the ease has got to at a fraction of the time, as the browser works it out.
export function easedAt(time: number): number {
  let low = 0;
  let high = 1;
  for (let round = 0; round < 40; round += 1) {
    const middle = (low + high) / 2;
    if (bezier(middle, EASE_POINTS.x1, EASE_POINTS.x2) < time) low = middle;
    else high = middle;
  }
  return bezier((low + high) / 2, EASE_POINTS.y1, EASE_POINTS.y2);
}

// The fraction of the time at which the ease has covered `progress` of the way.
export function timeFor(progress: number): number {
  let low = 0;
  let high = 1;
  for (let round = 0; round < 40; round += 1) {
    const middle = (low + high) / 2;
    if (easedAt(middle) < progress) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

// One @keyframes per route: a signal leaves the start, fades in and out, and
// follows the same samples as the line it rides. A pass is sampled at eased
// times, so it glides and settles on a linear clock. Transform and opacity only.
export function travelKeyframes(): string {
  const blocks: string[] = [];
  for (const layout of ['wide', 'tall'] as const) {
    for (const [id, route] of Object.entries(LAYOUTS[layout].routes)) {
      const first = at(route.points, 0);
      for (const kind of id === 'ha' || id === 'hb'
        ? (['travel', 'pass'] as const)
        : (['travel'] as const)) {
        const frames = route.points.map(([x, y], index) => {
          const progress = (index / (route.points.length - 1)) * 100;
          const stop = kind === 'pass' ? timeFor(progress / 100) * 100 : progress;
          const ramp = progress < 8 ? progress / 8 : 1;
          const opacity = kind === 'pass' || progress <= 92 ? ramp : (100 - progress) / 8;
          return `${stop.toFixed(2)}%{transform:translate(${(x - first[0]).toFixed(1)}px,${(y - first[1]).toFixed(1)}px);opacity:${opacity.toFixed(2)}}`;
        });
        blocks.push(`@keyframes ${keyframeName(layout, id as RouteId, kind)}{${frames.join('')}}`);
      }
    }
  }
  return blocks.join('\n');
}
export type Step = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export interface Activity {
  device: boolean;
  hub: boolean;
  appA: boolean;
  appB: boolean;
  routes: RouteId[];
  pass: 'a' | 'b' | null;
  chips: boolean;
  pulse: boolean;
  bArrived: boolean;
}

const NONE: Activity = {
  device: false,
  hub: false,
  appA: false,
  appB: false,
  routes: [],
  pass: null,
  chips: false,
  pulse: false,
  bArrived: true,
};

// Step 0 is the composed picture at rest: nothing moving, everything in place.
export const ACTIVITY: Record<Step, Activity> = {
  0: NONE,
  1: { ...NONE, device: true, appA: true, routes: ['da'], bArrived: false },
  2: { ...NONE, device: true, hub: true, routes: ['dh'], bArrived: false },
  3: { ...NONE, hub: true, chips: true, pulse: true, bArrived: false },
  4: { ...NONE, hub: true, appA: true, routes: ['ha'], pass: 'a', bArrived: false },
  5: { ...NONE, device: true, appB: true, routes: ['db'] },
  6: { ...NONE, hub: true, appB: true, routes: ['bh', 'hb'], pass: 'b', pulse: true },
  7: { ...NONE, hub: true, appA: true, appB: true, routes: ['ha', 'hb'] },
};

export interface Beat {
  label: string;
  // The label as shown on one line in the stepper; the full label stays the accessible name.
  short: string;
  caption: string;
  ms: number;
  claims: string[];
}

export const BEATS: Beat[] = [
  {
    label: 'Open the app',
    short: 'Open the app',
    caption: 'A person opens your app.',
    ms: 2500,
    claims: [],
  },
  {
    label: 'Go to Odudu',
    short: 'Go to Odudu',
    caption: 'Your app sends them to Odudu to sign in.',
    ms: 2500,
    claims: [],
  },
  {
    label: 'Sign in once',
    short: 'Sign in once',
    caption:
      "They sign in on Odudu's own page. Odudu supports passwords, passkeys and codes from an authenticator app.",
    ms: 3000,
    claims: ['passwords', 'passkeys', 'authenticator-codes'],
  },
  {
    label: 'Back with a signed pass',
    short: 'Signed pass',
    caption: 'Odudu sends them back with a signed pass, and your app lets them in.',
    ms: 2500,
    claims: [],
  },
  {
    label: 'Open a second app',
    short: 'Second app',
    caption: 'Later, they open a second app, and it sends them to Odudu too.',
    ms: 2500,
    claims: [],
  },
  {
    label: 'Already signed in',
    short: 'Signed in',
    caption:
      'Odudu sees they are already signed in, so it shows no sign-in page. Straight back, with no password asked. Sign in once, and use every app of that tenant that trusts Odudu.',
    ms: 3400,
    claims: ['single-sign-on'],
  },
  {
    label: 'Signed out where registered',
    short: 'Signed out',
    caption: 'Sign out of one, and the apps that registered for it are told.',
    ms: 2500,
    claims: ['back-channel-logout'],
  },
];
