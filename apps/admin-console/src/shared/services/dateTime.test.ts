import { describe, expect, it } from 'vitest';
import {
  edgeOfMinute,
  granularityOf,
  localText,
  readLocal,
  utcDay,
} from '#/shared/services/dateTime';

describe('the instant a picked minute stands for', () => {
  it('starts at its first millisecond', () => {
    expect(edgeOfMinute('2026-09-28T13:41:37.250Z', 'start')).toBe('2026-09-28T13:41:00.000Z');
  });

  it('ends at its last, so an upper bound that is inclusive takes the whole minute', () => {
    expect(edgeOfMinute('2026-09-28T13:41:00.000Z', 'end')).toBe('2026-09-28T13:41:59.999Z');
  });

  it('is written in UTC whatever offset it was given in', () => {
    expect(edgeOfMinute('2026-09-28T14:41:00+01:00', 'start')).toBe('2026-09-28T13:41:00.000Z');
  });
});

const NEW_YORK = 'America/New_York';

describe('what a date-time input holds', () => {
  it('is nothing for nothing, and not nothing for what a browser could not read', () => {
    expect(readLocal('', false, NEW_YORK, 'start', 'minute')).toEqual({ kind: 'empty' });
    const bad = readLocal('', true, NEW_YORK, 'start', 'minute');
    expect(bad).toMatchObject({ kind: 'problem' });
    expect(JSON.stringify(bad)).toMatch(/complete date and time/u);
  });

  it('is the instant, from the minute for a lower bound and to its end for an upper', () => {
    expect(readLocal('2026-09-28T14:41', false, 'Africa/Lagos', 'start', 'minute')).toEqual({
      kind: 'ok',
      iso: '2026-09-28T13:41:00.000Z',
    });
    expect(readLocal('2026-09-28T14:41', false, 'Africa/Lagos', 'end', 'minute')).toEqual({
      kind: 'ok',
      iso: '2026-09-28T13:41:59.999Z',
    });
  });

  it('keeps the seconds where the field shows them', () => {
    expect(readLocal('2026-09-28T14:41:30', false, 'Africa/Lagos', 'start', 'second')).toEqual({
      kind: 'ok',
      iso: '2026-09-28T13:41:30.000Z',
    });
  });

  it.each([
    ['02/30/2024', '2024-02-30T01:00'],
    ['02/29/2026', '2026-02-29T01:00'],
    ['31 April', '2026-04-31T01:00'],
  ])('refuses a day the month lacks: %s', (_name, text) => {
    expect(JSON.stringify(readLocal(text, false, NEW_YORK, 'start', 'minute'))).toMatch(
      /does not exist in that month/u,
    );
  });

  it('takes 29 February in a leap year', () => {
    expect(readLocal('2024-02-29T01:00', false, NEW_YORK, 'start', 'minute')).toMatchObject({
      kind: 'ok',
    });
  });

  it('refuses the hour a spring-forward skips, naming the zone', () => {
    expect(
      JSON.stringify(readLocal('2026-03-08T02:30', false, NEW_YORK, 'start', 'minute')),
    ).toContain('does not exist in America/New_York');
    expect(readLocal('2026-03-08T03:30', false, NEW_YORK, 'start', 'minute')).toMatchObject({
      kind: 'ok',
    });
  });

  it('reads a time a fall-back repeats as the earlier of the two', () => {
    expect(readLocal('2026-11-01T01:30', false, NEW_YORK, 'start', 'minute')).toEqual({
      kind: 'ok',
      iso: '2026-11-01T05:30:00.000Z',
    });
  });

  it('writes an instant back as the zone reads it, with seconds where asked', () => {
    expect(localText('2026-09-28T13:41:00.000Z', 'Africa/Lagos', 'minute')).toBe(
      '2026-09-28T14:41',
    );
    expect(localText('2026-09-28T13:41:30.000Z', 'UTC', 'second')).toBe('2026-09-28T13:41:30');
    expect(localText('2026-11-01T06:30:00.000Z', NEW_YORK, 'minute')).toBe('2026-11-01T01:30');
  });
});

describe('the precision a field shows an instant at', () => {
  it('is the minute for what a minute field wrote, at either end', () => {
    expect(granularityOf('2026-09-28T13:41:00.000Z', 'start')).toBe('minute');
    expect(granularityOf('2026-09-28T13:41:59.999Z', 'end')).toBe('minute');
  });

  it('is the second where the address holds seconds, so the field shows what is sent', () => {
    expect(granularityOf('2026-09-28T13:41:30.000Z', 'start')).toBe('second');
    expect(granularityOf('2026-09-28T13:41:30Z', 'end')).toBe('second');
    expect(granularityOf('2026-09-28T13:41:59.999Z', 'start')).toBe('second');
  });
});

describe('the UTC day of an instant', () => {
  it('is the date an export is named by, wherever the person is', () => {
    expect(utcDay(new Date('2026-09-29T23:59:00Z'))).toBe('2026-09-29');
    expect(utcDay(new Date('2026-09-30T00:00:00Z'))).toBe('2026-09-30');
    expect(utcDay(new Date('2026-01-05T08:00:00+05:00'))).toBe('2026-01-05');
  });
});
