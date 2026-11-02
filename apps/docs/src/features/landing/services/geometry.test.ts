import { describe, expect, it } from 'vitest';
import {
  ACTIVITY,
  BEATS,
  LAYOUTS,
  SCENE_EASE,
  easedAt,
  timeFor,
  keyframeName,
  pathData,
  travelKeyframes,
} from '@site/src/features/landing/services/geometry';

describe('the sign-in scene geometry', () => {
  it('has seven beats, each with a caption, a time and claims that are named', () => {
    expect(BEATS).toHaveLength(7);
    for (const beat of BEATS) {
      expect(beat.caption.length).toBeGreaterThan(15);
      expect(beat.ms).toBeGreaterThan(1000);
    }
  });

  it('has an activity for rest and for every beat', () => {
    expect(Object.keys(ACTIVITY)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7']);
    expect(ACTIVITY[0].routes).toEqual([]);
    expect(ACTIVITY[3].chips).toBe(true);
    expect(ACTIVITY[6].chips).toBe(false);
  });

  it('draws each route from its first sample to its last and ends it with an arrowhead', () => {
    for (const layout of Object.values(LAYOUTS)) {
      for (const route of Object.values(layout.routes)) {
        const first = route.points[0];
        const last = route.points[route.points.length - 1];
        expect(pathData(route.points).startsWith(`M${(first?.[0] ?? 0).toFixed(1)}`)).toBe(true);
        expect(route.head.at).toEqual(last);
      }
    }
  });

  it('writes one set of keyframes per route and layout, passes only for the two returns', () => {
    const css = travelKeyframes();
    expect(css.match(/@keyframes travel-/gu)).toHaveLength(12);
    expect(css.match(/@keyframes pass-/gu)).toHaveLength(4);
    expect(css).toContain(`@keyframes ${keyframeName('wide', 'ha', 'pass')}`);
    expect(css).not.toContain('pass-wide-da');
  });

  it('holds each beat about two and a half seconds, longer where the story is', () => {
    expect(BEATS.map((beat) => beat.ms)).toEqual([2500, 2500, 3000, 2500, 2500, 3400, 2500]);
  });

  it('eases in and out: slow at the ends, even at the middle, and invertible', () => {
    expect(easedAt(0)).toBeCloseTo(0, 6);
    expect(easedAt(1)).toBeCloseTo(1, 6);
    expect(easedAt(0.5)).toBeCloseTo(0.5, 3);
    expect(easedAt(0.1)).toBeLessThan(0.1);
    expect(easedAt(0.9)).toBeGreaterThan(0.9);
    for (const progress of [0.1, 0.25, 0.5, 0.8]) {
      expect(easedAt(timeFor(progress))).toBeCloseTo(progress, 3);
    }
    expect(SCENE_EASE).toBe('cubic-bezier(0.45, 0, 0.55, 1)');
  });

  it('samples the pass at eased times so it glides and settles on a linear clock', () => {
    const css = travelKeyframes();
    const block = new RegExp(
      `@keyframes ${keyframeName('wide', 'ha', 'pass')}\\{(.*?)\\}\\}`,
      'u',
    ).exec(css);
    const stops = [...(block?.[1] ?? '').matchAll(/([\d.]+)%\{/gu)].map((m) => Number(m[1]));
    expect(stops[0]).toBe(0);
    expect(stops[stops.length - 1]).toBe(100);
    expect(stops.every((stop, index) => index === 0 || stop > (stops[index - 1] ?? 0))).toBe(true);
    const gaps = stops.slice(1).map((stop, index) => stop - (stops[index] ?? 0));
    const middle = gaps[Math.floor(gaps.length / 2)] ?? 0;
    expect(gaps[0]).toBeGreaterThan(middle);
    expect(gaps[gaps.length - 1]).toBeGreaterThan(middle);
  });
});
