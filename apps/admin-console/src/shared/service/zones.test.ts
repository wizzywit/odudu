import { describe, expect, it } from 'vitest';
import { isValidZoneinfo } from '@odudu/contracts';
import { offsetOf, timeZoneOptions, zoneProblem } from '#/shared/service/zones.ts';

const JANUARY = new Date('2026-01-15T12:00:00Z');
const JULY = new Date('2026-07-15T12:00:00Z');

describe('time zones', () => {
  it('lists every zone the browser knows, UTC among them, each one the server accepts', () => {
    const ids = timeZoneOptions(JANUARY).map((o) => o.id);
    expect(ids).toContain('Africa/Lagos');
    expect(ids).toContain('UTC');
    expect(ids.every(isValidZoneinfo)).toBe(true);
  });

  it('shows each with its offset now, which follows daylight saving', () => {
    expect(offsetOf('Africa/Lagos', JANUARY)).toBe('UTC+01:00');
    expect(offsetOf('Europe/London', JANUARY)).toBe('UTC+00:00');
    expect(offsetOf('Europe/London', JULY)).toBe('UTC+01:00');
    expect(offsetOf('America/St_Johns', JANUARY)).toBe('UTC-03:30');
    const lagos = timeZoneOptions(JANUARY).find((o) => o.id === 'Africa/Lagos');
    expect(lagos?.label).toBe('Africa/Lagos');
    expect(lagos?.detail).toBe('UTC+01:00');
  });
});

describe('zoneProblem', () => {
  it('refuses only a name in no shape the server takes', () => {
    expect(zoneProblem('')).toBeNull();
    expect(zoneProblem('Asia/Calcutta')).toBeNull();
    expect(zoneProblem('+1')).toBe('Choose a zone from the list, such as Africa/Lagos.');
  });
});
