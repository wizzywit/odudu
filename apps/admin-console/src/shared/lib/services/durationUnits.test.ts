import { describe, expect, it } from 'vitest';
import {
  durationUnit,
  fittingUnit,
  inUnit,
  secondsAfterSwitch,
  secondsOf,
  unitShown,
} from '#/shared/lib/services/durationUnits';

describe('fittingUnit', () => {
  it.each([
    [1800, 'min'],
    [36_000, 'h'],
    [86_400, 'd'],
    [90, 's'],
    [0, 's'],
    [Number.NaN, 's'],
  ])('reads %s seconds in %s', (seconds, id) => {
    expect(fittingUnit(seconds).id).toBe(id);
  });
});

describe('unitShown', () => {
  it('keeps the unit picked while it divides the value, else fits one', () => {
    expect(unitShown(7200, durationUnit('min')).id).toBe('min');
    expect(unitShown(90, durationUnit('h')).id).toBe('s');
    expect(unitShown(Number.NaN, durationUnit('h')).id).toBe('h');
    expect(unitShown(7200, null).id).toBe('h');
  });
});

describe('secondsAfterSwitch', () => {
  it('keeps the seconds where the unit divides them, else the nearest whole count', () => {
    expect(secondsAfterSwitch(7200, durationUnit('h'))).toBe(7200);
    expect(secondsAfterSwitch(5400, durationUnit('h'))).toBe(7200);
    expect(secondsAfterSwitch(10, durationUnit('h'))).toBe(3600);
    expect(secondsAfterSwitch(Number.NaN, durationUnit('h'))).toBeNaN();
  });
});

describe('conversion', () => {
  it('goes both ways and keeps a cleared field cleared', () => {
    expect(inUnit(7200, durationUnit('h'))).toBe(2);
    expect(secondsOf(2, durationUnit('h'))).toBe(7200);
    expect(inUnit(Number.NaN, durationUnit('h'))).toBeNaN();
    expect(secondsOf(Number.NaN, durationUnit('h'))).toBeNaN();
  });
});
