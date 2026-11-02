const MINUTE_MS = 60_000;

// A date-time field picks a minute, and the API takes an instant in UTC.
// A lower bound is the minute's first millisecond and an upper one its last,
// since both ends of a range are inclusive.
export function edgeOfMinute(iso: string, edge: 'start' | 'end'): string {
  const start = Math.floor(Date.parse(iso) / MINUTE_MS) * MINUTE_MS;
  return new Date(edge === 'start' ? start : start + MINUTE_MS - 1).toISOString();
}

const DAY_MS = 86_400_000;
const LOCAL = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d))?$/u;
const PARTS = ['year', 'month', 'day', 'hour', 'minute'] as const;

function daysIn(month: number, year: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function localParts(ms: number, zone: string): number[] {
  const read = new Intl.DateTimeFormat('en', {
    timeZone: zone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms));
  return PARTS.map((name) => Number(read.find((part) => part.type === name)?.value));
}

function offsetMs(ms: number, zone: string): number {
  const [year = 0, month = 1, day = 1, hour = 0, minute = 0] = localParts(ms, zone);
  return Date.UTC(year, month - 1, day, hour, minute) - Math.floor(ms / 60_000) * 60_000;
}

// The instants a wall-clock time is, in a zone: none where a clock change
// skipped it, two where one repeated it. The offsets a day either side bracket
// any change, and each gives an instant that reads back as the time asked for
// exactly when it is one.
function instantsOf(parts: readonly number[], zone: string): number[] {
  const [year = 0, month = 1, day = 1, hour = 0, minute = 0] = parts;
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const found = [guess - DAY_MS, guess + DAY_MS]
    .map((near) => guess - offsetMs(near, zone))
    .filter((candidate) => localParts(candidate, zone).every((value, i) => value === parts[i]));
  return [...new Set(found)].sort((a, b) => a - b);
}

export const NOT_COMPLETE =
  'That is not a complete date and time. Fill in every part, with a day the month has, or clear it.';

export type LocalReading =
  { kind: 'empty' } | { kind: 'ok'; iso: string } | { kind: 'problem'; message: string };

// What a date-time input holds, as an instant in the zone it is read in. A
// browser gives '' for a value it cannot read, and says it was typed with
// `badInput`, so neither is taken for an empty field. A time a spring-forward
// skips has no reading; a time a fall-back repeats is the earlier of the two,
// so a lower bound includes the whole repeat and nothing is lost.
export function readLocal(
  text: string,
  badInput: boolean,
  zone: string,
  edge: 'start' | 'end',
  precision: 'minute' | 'second',
): LocalReading {
  if (text === '') return badInput ? { kind: 'problem', message: NOT_COMPLETE } : { kind: 'empty' };
  const match = LOCAL.exec(text);
  if (match === null) return { kind: 'problem', message: NOT_COMPLETE };
  const [year = 0, month = 1, day = 1, hour = 0, minute = 0, second = 0] = match
    .slice(1)
    .map((part) => Number(part || 0));
  if (month < 1 || month > 12 || day < 1 || day > daysIn(month, year)) {
    return { kind: 'problem', message: 'That day does not exist in that month and year.' };
  }
  const [first] = instantsOf([year, month, day, hour, minute], zone);
  if (first === undefined) {
    return {
      kind: 'problem',
      message: `That time does not exist in ${zone}: the clocks skip it. Choose a time before or after.`,
    };
  }
  const iso = new Date(first + second * 1000).toISOString();
  return { kind: 'ok', iso: precision === 'second' ? iso : edgeOfMinute(iso, edge) };
}

// An instant as the text a date-time input holds, read in a zone.
export function localText(iso: string, zone: string, precision: 'minute' | 'second'): string {
  const at = new Date(iso).getTime();
  const [year = 0, month = 1, day = 1, hour = 0, minute = 0] = localParts(at, zone);
  const two = (n: number): string => String(n).padStart(2, '0');
  const base = `${String(year).padStart(4, '0')}-${two(month)}-${two(day)}T${two(hour)}:${two(minute)}`;
  return precision === 'second' ? `${base}:${two(new Date(at).getUTCSeconds())}` : base;
}

// A field shows a minute unless the instant it holds is not one a minute
// field would have written, in which case it shows seconds too, so what is
// shown is what is sent.
export function granularityOf(iso: string, edge: 'start' | 'end'): 'minute' | 'second' {
  return new Date(iso).toISOString() === edgeOfMinute(iso, edge) ? 'minute' : 'second';
}
