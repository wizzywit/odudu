import { describe, expect, it } from 'vitest';
import { BEATS, LAYOUTS, type Step } from '@site/src/features/landing/services/geometry';
import {
  CHIPS,
  STAGE,
  boundsOf,
  buildScene,
  checkPath,
  chipStarts,
  flag,
  headTransform,
  lamps,
  passRouteOf,
  skeleton,
} from '@site/src/features/landing/services/scene';
import { TIMING } from '@site/src/features/landing/services/timing';

describe('the sign-in scene drawing', () => {
  it('draws a form for the browser and a page for an app, inside the window', () => {
    for (const layout of Object.values(LAYOUTS)) {
      const box = layout.appA;
      for (const kind of ['form', 'app'] as const) {
        const shapes = skeleton(box, box.y + 52, kind);
        expect(shapes.length).toBeGreaterThanOrEqual(5);
        for (const shape of shapes) {
          expect(shape.x).toBeGreaterThanOrEqual(box.x);
          expect(shape.x + (shape.width ?? 0)).toBeLessThanOrEqual(box.x + box.w);
        }
      }
    }
    expect(skeleton(LAYOUTS.wide.device, 0, 'form').map((shape) => shape.look)).toEqual([
      'bar',
      'field',
      'bar',
      'field',
      'cta',
    ]);
  });

  it('puts three lamps in a title bar and centres the chips on the hub', () => {
    expect(lamps({ x: 10, y: 20, w: 100, h: 50 })).toEqual([
      [28, 38],
      [40, 38],
      [52, 38],
    ]);
    const starts = chipStarts(100);
    const last = CHIPS.length - 1;
    const end = (starts[last] ?? 0) + (CHIPS[last]?.width ?? 0);
    expect(100 - (starts[0] ?? 0)).toBeCloseTo(end - 100);
  });

  it('names the route a pass takes and draws marks as the page always has', () => {
    expect(passRouteOf('a')).toBe('ha');
    expect(passRouteOf('b')).toBe('hb');
    expect(passRouteOf(null)).toBeUndefined();
    expect(checkPath(10, 10, 10)).toMatch(/^M5\.8 10\.5L9 13\.4L14\.6/u);
    expect(headTransform([3, 4], 90)).toBe('translate(3 4) rotate(90)');
    expect(flag(true)).toBe('true');
    expect(flag(false)).toBe('false');
  });
});

describe('the sign-in scene model', () => {
  const steps: Step[] = [0, 1, 2, 3, 4, 5, 6, 7];

  it('draws a line for each base route and never for the return route', () => {
    for (const step of steps) {
      const ids = buildScene('wide', step).lines.map((line) => line.id);
      expect(ids).toEqual(['dh', 'da', 'db', 'ha', 'hb']);
    }
  });

  it('draws the return arrowhead only while that route is active', () => {
    const shown = steps.filter((step) =>
      buildScene('wide', step).heads.some((head) => head.id === 'bh'),
    );
    expect(shown).toEqual([6]);
    expect(buildScene('wide', 6).heads.find((head) => head.id === 'bh')?.lit).toBe('true');
  });

  it('stages each step: the route draws first, the pass follows, and an idle route waits for nothing', () => {
    const lines = buildScene('wide', 4).lines;
    const lit = lines.find((line) => line.on === 'true');
    expect(lit?.id).toBe('ha');
    expect(lit?.delay).toBe(STAGE.route);
    expect(lines.filter((line) => line.on === 'false').every((line) => line.delay === 0)).toBe(
      true,
    );
    expect(buildScene('wide', 4).tickets[0]?.delay).toBe(STAGE.pass);
    expect(buildScene('wide', 4).tickets[0]?.delay).toBeGreaterThan(STAGE.route);
  });

  it('draws the second route of the return step after the first', () => {
    const scene = buildScene('wide', 6);
    const second = scene.lines.find((line) => line.id === 'hb')?.delay ?? 0;
    expect(second).toBeGreaterThan(STAGE.route);
    expect(scene.tickets[0]?.delay).toBeGreaterThan(second);
  });

  it('lights an arrowhead as its route arrives, not before', () => {
    const heads = buildScene('wide', 4).heads;
    expect(heads.find((head) => head.id === 'ha')?.lit).toBe('true');
    expect(heads.find((head) => head.id === 'db')?.lit).toBe('false');
  });
});

describe('the route mask region', () => {
  it('encloses a route and its stroke, and no more than that', () => {
    const points: [number, number][] = [
      [10, 20],
      [60, 5],
      [30, 90],
    ];
    expect(boundsOf(points, 6)).toEqual({ x: 4, y: -1, w: 62, h: 97 });
  });

  it('is given to every drawn line, around all of its points', () => {
    for (const layout of ['wide', 'tall'] as const) {
      for (const line of buildScene(layout, 4).lines) {
        const numbers = [...line.d.matchAll(/(-?\d+\.?\d*) (-?\d+\.?\d*)/gu)].map((m) => [
          Number(m[1]),
          Number(m[2]),
        ]);
        for (const [x = 0, y = 0] of numbers) {
          expect(x).toBeGreaterThanOrEqual(line.mask.x + 5);
          expect(x).toBeLessThanOrEqual(line.mask.x + line.mask.w - 5);
          expect(y).toBeGreaterThanOrEqual(line.mask.y + 5);
          expect(y).toBeLessThanOrEqual(line.mask.y + line.mask.h - 5);
        }
      }
    }
  });
});

describe('the stage against the durations', () => {
  it('lights an arrowhead while its route is still drawing, and sends the pass inside the draw', () => {
    expect(STAGE.head).toBeGreaterThan(TIMING.drawMs / 2);
    expect(STAGE.head).toBeLessThan(TIMING.drawMs);
    expect(STAGE.pass).toBeGreaterThan(STAGE.route);
    expect(STAGE.pass).toBeLessThan(STAGE.route + TIMING.drawMs);
  });

  it('draws the return route after the first has finished, and its pass behind that line', () => {
    expect(STAGE.returnRoute).toBeGreaterThanOrEqual(STAGE.route + TIMING.drawMs);
    expect(STAGE.returnPass).toBeGreaterThan(STAGE.returnRoute);
    expect(STAGE.returnPass).toBeLessThan(STAGE.returnRoute + TIMING.drawMs);
  });

  it('fits the busiest step inside its hold, with the pass settled before the next step', () => {
    const passMs = 1500;
    expect(STAGE.returnPass + passMs).toBeLessThan(BEATS[5]?.ms ?? 0);
    expect(STAGE.pass + passMs).toBeLessThan(BEATS[3]?.ms ?? 0);
  });
});
