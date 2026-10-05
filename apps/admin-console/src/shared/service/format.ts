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
    if (count > 0) parts.push(`${String(count)} ${unit}${count === 1 ? '' : 's'}`);
  }
  return `${raw} · ${parts.join(' ')}`;
}

export function formatAbsolute(instant: Date): string {
  const iso = instant.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
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

export function sentence(text: string): string {
  const said = text.charAt(0).toUpperCase() + text.slice(1);
  return said.endsWith('.') ? said : `${said}.`;
}

export function counted(count: number, one: string, other: string): string {
  return `${String(count)} ${count === 1 ? one : other}`;
}

export function flagText(value: unknown, on: string, off: string): string {
  return value === true ? on : off;
}

// A conflict's way of showing a list of ids: by name where one is known.
export function describeIds(value: unknown, nameOf: (id: string) => string): string {
  const ids = Array.isArray(value) ? value.map(String) : [];
  return ids.length === 0 ? 'none' : ids.map(nameOf).join(', ');
}
