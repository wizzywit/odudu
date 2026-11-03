import { keyframeName } from '@site/src/features/landing/services/sceneMotion';
import {
  LAYOUTS,
  pathData,
  type Box,
  type LayoutName,
  type Point,
  type RouteId,
} from '@site/src/features/landing/services/sceneLayouts';
import {
  CHIPS,
  RING_SCALES,
  chipStarts,
  lamps,
  skeleton,
  type Shape,
} from '@site/src/features/landing/services/sceneShapes';
import { ACTIVITY, type Step } from '@site/src/features/landing/services/signInBeats';

// The sign-in scene as plain data: every position, every flag and every
// animation name the drawing needs, so the view only maps it to elements.

const PASS_ROUTES: Record<'a' | 'b', RouteId> = { a: 'ha', b: 'hb' };

export function passRouteOf(pass: 'a' | 'b' | null): RouteId | undefined {
  return pass === null ? undefined : PASS_ROUTES[pass];
}

// A check mark drawn inside a circle of radius `r` centred on (x, y).
export function checkPath(x: number, y: number, r: number): string {
  const at = (dx: number, dy: number): string => `${String(x + dx)} ${String(y + dy)}`;
  return `M${at(-r * 0.42, 0.5)}L${at(-r * 0.1, r * 0.34)}L${at(r * 0.46, -r * 0.36)}`;
}

// An arrowhead pointing along `angle`, placed at the end of a route.
export function headTransform(at: Point, angle: number): string {
  return `translate(${String(at[0])} ${String(at[1])}) rotate(${String(angle)})`;
}

export function flag(on: boolean): string {
  return on ? 'true' : 'false';
}

export interface CheckModel {
  x: number;
  y: number;
  r: number;
  path: string;
  on: string;
}

export interface WindowModel {
  label: string;
  kind: 'form' | 'app';
  on: string;
  away: string;
  halo: Box;
  frame: Box;
  rule: string;
  lamps: Point[];
  labelAt: Point;
  shapes: Shape[];
  // The app's own check once signed in: none, or one.
  signs: CheckModel[];
}

export interface ChipModel {
  label: string;
  claim: string;
  x: number;
  y: number;
  width: number;
  textAt: Point;
  delay: number;
  lit: string;
}

// A route's line, drawn for the base routes only.
export interface LineModel {
  id: RouteId;
  d: string;
  on: string;
  // When its drawing starts: staged after the nodes have lit; none while it is off.
  delay: number;
  // The region its draw-in mask needs: the route and its stroke.
  mask: Box;
}

// An arrowhead, drawn for each base route and for the return route while it is active.
export interface HeadModel {
  id: RouteId;
  at: string;
  lit: string;
  // When it lights: as its route arrives; none while it is dim.
  delay: number;
}

export interface DotModel {
  key: string;
  at: Point;
  name: string;
  delay: number;
}

export interface TicketModel {
  start: Point;
  name: string;
  delay: number;
}

export interface SceneModel {
  viewBox: string;
  glow: { cx: number; cy: number; r: number };
  rings: { r: number; delay: number; pulse: string }[];
  lines: LineModel[];
  heads: HeadModel[];
  device: WindowModel;
  appA: WindowModel;
  appB: WindowModel;
  bAway: string;
  hub: {
    on: string;
    told: string;
    halo: Box;
    card: Box;
    sheen: Box;
    staff: string;
    check: CheckModel;
    nameAt: Point;
    chips: ChipModel[];
  };
  dots: DotModel[];
  // The pass travelling a route: none, or one.
  tickets: TicketModel[];
}

// Milliseconds into a step at which each part of it begins: the nodes first,
// then the route draws itself, then the pass rides it. The return step runs two routes.
export const STAGE = { route: 150, pass: 600, head: 550, returnRoute: 1150, returnPass: 1300 };

function routeDelay(id: RouteId, step: Step): number {
  return id === 'hb' && step === 6 ? STAGE.returnRoute : STAGE.route;
}

// Half the mask's stroke, and a little over.
const MASK_PAD = 6;

// The smallest box around some points, grown by `pad` on every side.
export function boundsOf(points: Point[], pad: number): Box {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const left = Math.min(...xs) - pad;
  const top = Math.min(...ys) - pad;
  return { x: left, y: top, w: Math.max(...xs) + pad - left, h: Math.max(...ys) + pad - top };
}

const BASE_ROUTES: RouteId[] = ['dh', 'da', 'db', 'ha', 'hb'];
const HEAD_ROUTES: RouteId[] = ['dh', 'da', 'db', 'ha', 'hb', 'bh'];

function grown(box: Box, by: number): Box {
  return { x: box.x - by, y: box.y - by, w: box.w + 2 * by, h: box.h + 2 * by };
}

function checkOf(x: number, y: number, r: number, on: boolean): CheckModel {
  return { x, y, r, path: checkPath(x, y, r), on: flag(on) };
}

function windowOf(
  box: Box,
  label: string,
  kind: 'form' | 'app',
  on: boolean,
  signed: boolean | undefined,
  away: boolean,
): WindowModel {
  return {
    label,
    kind,
    on: flag(on),
    away: flag(away),
    halo: grown(box, 5),
    frame: box,
    rule: `M${String(box.x)} ${String(box.y + 36)}H${String(box.x + box.w)}`,
    lamps: lamps(box),
    labelAt: [box.x + 68, box.y + 23],
    shapes: skeleton(box, box.y + 52, kind),
    signs: signed === undefined ? [] : [checkOf(box.x + box.w - 24, box.y + 18, 9, signed)],
  };
}

// Whether a step shows the app's own check: signed in from the pass until the sign-out.
function appASigned(step: Step): boolean {
  return step === 0 || (step >= 4 && step <= 6);
}

// The scene at a step, in one layout.
export function buildScene(layout: LayoutName, step: Step): SceneModel {
  const geometry = LAYOUTS[layout];
  const activity = ACTIVITY[step];
  const { hub } = geometry;
  const cx = hub.x + hub.w / 2;
  const cy = hub.y + hub.h / 2;
  const starts = chipStarts(cx);
  const passRoute = passRouteOf(activity.pass);
  const atRest = step === 0;
  const hubSigned = atRest || step === 6;
  const withBase = (id: RouteId): boolean =>
    activity.routes.includes(id) || (id === 'hb' && activity.routes.includes('bh'));
  return {
    viewBox: `0 0 ${String(geometry.width)} ${String(geometry.height)}`,
    glow: { cx, cy, r: hub.w * 0.95 },
    rings: RING_SCALES.map((scale, index) => ({
      r: hub.w * scale,
      delay: index * 220,
      pulse: flag(activity.pulse),
    })),
    lines: BASE_ROUTES.map((id) => ({
      id,
      d: pathData(geometry.routes[id].points),
      on: flag(withBase(id)),
      delay: withBase(id) ? routeDelay(id, step) : 0,
      mask: boundsOf(geometry.routes[id].points, MASK_PAD),
    })),
    heads: HEAD_ROUTES.filter((id) => BASE_ROUTES.includes(id) || activity.routes.includes(id)).map(
      (id) => ({
        id,
        at: headTransform(geometry.routes[id].head.at, geometry.routes[id].head.angle),
        lit: flag(activity.routes.includes(id)),
        delay: activity.routes.includes(id) ? routeDelay(id, step) + STAGE.head : 0,
      }),
    ),
    device: windowOf(geometry.device, 'Their browser', 'form', activity.device, undefined, false),
    appA: windowOf(geometry.appA, 'App A', 'app', activity.appA, appASigned(step), false),
    appB: windowOf(
      geometry.appB,
      'App B',
      'app',
      activity.appB,
      atRest || step === 6,
      !activity.bArrived,
    ),
    bAway: flag(!activity.bArrived),
    hub: {
      on: flag(activity.hub),
      told: flag(step === 7),
      halo: grown(hub, 6),
      card: hub,
      sheen: { x: hub.x + 1, y: hub.y + 1, w: hub.w - 2, h: hub.h - 2 },
      staff: `translate(${String(cx)} ${String(hub.y + 62)}) scale(3.3)`,
      check: checkOf(cx + 38, hub.y + 44, 15, hubSigned),
      nameAt: [cx, hub.y + 182],
      chips: CHIPS.map((chip, index) => ({
        label: chip.label,
        claim: chip.claim,
        x: starts[index] ?? 0,
        y: hub.y + 208,
        width: chip.width,
        textAt: [(starts[index] ?? 0) + chip.width / 2, hub.y + 227],
        delay: index * 1100,
        lit: flag(activity.chips),
      })),
    },
    dots: activity.routes.flatMap((id) =>
      [0, 1, 2].map((index) => ({
        key: `${id}-${String(index)}`,
        at: geometry.routes[id].points[0] ?? [0, 0],
        name: keyframeName(layout, id),
        delay: index * 520 + (id === 'hb' && step === 6 ? 1300 : 0),
      })),
    ),
    tickets:
      passRoute === undefined
        ? []
        : [
            {
              start: geometry.routes[passRoute].points[0] ?? [0, 0],
              name: keyframeName(layout, passRoute, 'pass'),
              delay: step === 6 ? STAGE.returnPass : STAGE.pass,
            },
          ],
  };
}
