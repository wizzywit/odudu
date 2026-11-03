import { describe, expect, it } from 'vitest';
import {
  SCENE_EASE,
  easedAt,
  keyframeName,
  timeFor,
  travelKeyframes,
} from '@site/src/features/landing/services/sceneMotion';

describe('the sign-in scene motion', () => {
  it('writes one set of keyframes per route and layout, passes only for the two returns', () => {
    const css = travelKeyframes();
    expect(css.match(/@keyframes travel-/gu)).toHaveLength(12);
    expect(css.match(/@keyframes pass-/gu)).toHaveLength(4);
    expect(css).toContain(`@keyframes ${keyframeName('wide', 'ha', 'pass')}`);
    expect(css).not.toContain('pass-wide-da');
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
