import {
  LAYOUTS,
  pointAt,
  type LayoutName,
  type RouteId,
} from '@site/src/features/landing/services/sceneLayouts';

// How the signals move: the shared ease, the keyframes that carry them.

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
      const first = pointAt(route.points, 0);
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
