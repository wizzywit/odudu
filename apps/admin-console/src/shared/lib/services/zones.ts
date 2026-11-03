import { isValidZoneinfo } from '@odudu/contracts';

export interface ZoneOption {
  id: string;
  label: string;
  detail: string;
}

// "GMT+01:00" as Intl writes it, or "GMT" alone at a zero offset.
export function offsetOf(zone: string, now: Date): string {
  const parts = new Intl.DateTimeFormat('en', { timeZone: zone, timeZoneName: 'longOffset' })
    .formatToParts(now)
    .find((part) => part.type === 'timeZoneName');
  const offset = (parts?.value ?? 'GMT').replace(/^GMT/u, '');
  return `UTC${offset === '' ? '+00:00' : offset}`;
}

export function timeZoneOptions(now: Date): readonly ZoneOption[] {
  const zones = Intl.supportedValuesOf('timeZone').filter(isValidZoneinfo);
  const every = zones.includes('UTC') ? zones : ['UTC', ...zones];
  return every.map((zone) => ({ id: zone, label: zone, detail: offsetOf(zone, now) }));
}

export function zoneProblem(value: string): string | null {
  return value === '' || isValidZoneinfo(value)
    ? null
    : 'Choose a zone from the list, such as Africa/Lagos.';
}

// An instant as a zone reads it, beside its offset, to the second.
export function formatInZone(instant: Date, zone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(instant)
      .map((part) => [part.type, part.value]),
  );
  const date = `${String(parts.year)}-${String(parts.month)}-${String(parts.day)}`;
  const time = `${String(parts.hour)}:${String(parts.minute)}:${String(parts.second)}`;
  return `${date} ${time} ${zone} (${offsetOf(zone, instant)})`;
}

export function localZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
