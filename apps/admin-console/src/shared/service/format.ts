const UNITS = [
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
  ['second', 1],
] as const;

// Exact to the second, never "about a minute"; the raw value stays as given.
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—';
  const raw = `${String(seconds)} s`;
  if (seconds < 60) return raw;
  let rest = Math.round(seconds);
  const parts: string[] = [];
  for (const [unit, size] of UNITS) {
    const count = Math.floor(rest / size);
    rest -= count * size;
    if (count > 0) parts.push(counted(count, unit, `${unit}s`));
  }
  return `${raw} · ${parts.join(' ')}`;
}

export function formatAbsolute(instant: Date): string {
  const iso = instant.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
}

// Thousands grouped, as the console writes every count.
const GROUPED = new Intl.NumberFormat('en');

export function groupedNumber(value: number): string {
  return GROUPED.format(value);
}

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

const STEPS = [
  ['year', 365 * 86_400],
  ['month', 30 * 86_400],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
  ['second', 1],
] as const;

export function formatRelative(instant: Date, now: Date): string {
  const delta = Math.round((instant.getTime() - now.getTime()) / 1000);
  const magnitude = Math.abs(delta);
  for (const [unit, size] of STEPS) {
    if (magnitude >= size) return RELATIVE.format(Math.trunc(delta / size), unit);
  }
  return RELATIVE.format(0, 'second');
}

const AND = new Intl.ListFormat('en-GB', { type: 'conjunction' });

export function andList(items: readonly string[]): string {
  return AND.format(items);
}

export function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

export function sentence(text: string): string {
  const said = capitalise(text);
  return said.endsWith('.') ? said : `${said}.`;
}

export function plural(count: number, one: string, other: string): string {
  return count === 1 ? one : other;
}

export function counted(count: number, one: string, other: string): string {
  return `${String(count)} ${plural(count, one, other)}`;
}

export function attemptsText(attempts: number): string {
  return counted(attempts, 'attempt', 'attempts');
}

// How many bytes a text takes in UTF-8, which is what the server bounds.
export function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

// A text field emptied clears the value: blank is null.
export function nullWhenBlank(text: string): string | null {
  return text.trim() === '' ? null : text;
}

// A text a record may not hold, as a field's value.
export function orBlank(value: string | null | undefined): string {
  return value ?? '';
}

export function flagText(value: unknown, on: string, off: string): string {
  return value === true ? on : off;
}

// A conflict's way of showing one id, or none.
export function describeId(value: unknown, nameOf: (id: string) => string): string {
  return typeof value === 'string' ? nameOf(value) : 'none';
}

// A conflict's way of showing a list of ids: by name where one is known.
export function describeIds(value: unknown, nameOf: (id: string) => string): string {
  const ids = Array.isArray(value) ? value.map(String) : [];
  return ids.length === 0 ? 'none' : ids.map(nameOf).join(', ');
}

export interface SizeReading {
  text: string;
  over: boolean;
}

// How much of a limit in bytes is used, or by how much it is passed.
export function byteSizeReading(used: number, limit: number): SizeReading {
  return used > limit
    ? {
        text: `${groupedNumber(used - limit)} bytes over the limit of ${groupedNumber(limit)}.`,
        over: true,
      }
    : { text: `${groupedNumber(used)} of ${groupedNumber(limit)} bytes.`, over: false };
}

// The first `limit` characters of `text` and an ellipsis when it is longer.
export function shortened(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

const KIB = 1024;
const MIB = KIB * KIB;
// Below this a KiB value would print as 1024.0 KiB, so it reads in MiB.
const MIB_ROUNDS_UP_FROM = MIB - KIB / 20;

function unitsOf(bytes: number, unit: number, name: string): string {
  const value = bytes / unit;
  return `${Number.isInteger(value) ? String(value) : value.toFixed(1)} ${name}`;
}

// A size as a person reads it: whole when it is whole, else one decimal.
export function bytesText(bytes: number): string {
  if (bytes < KIB) return `${String(bytes)} bytes`;
  return bytes < MIB_ROUNDS_UP_FROM ? unitsOf(bytes, KIB, 'KiB') : unitsOf(bytes, MIB, 'MiB');
}
