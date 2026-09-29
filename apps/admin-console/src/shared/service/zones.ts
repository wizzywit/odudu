import { isValidZoneinfo } from '@odudu/contracts';

export interface ZoneOption {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
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
