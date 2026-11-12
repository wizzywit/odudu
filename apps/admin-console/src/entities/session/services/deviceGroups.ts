import { counted } from '#/shared/lib/services/format';

interface HasDevice {
  device: string | null;
}

// The rows with each device's together, devices in the order they first
// appear and rows with no device last, each group in its original order.
export function groupByDevice<T extends HasDevice>(rows: readonly T[]): T[] {
  const groups = new Map<string, T[]>();
  const none: T[] = [];
  for (const row of rows) {
    if (row.device === null) {
      none.push(row);
      continue;
    }
    const group = groups.get(row.device) ?? [];
    group.push(row);
    groups.set(row.device, group);
  }
  return [...[...groups.values()].flat(), ...none];
}

export function deviceSizeOf(rows: readonly HasDevice[]): (device: string | null) => number {
  const sizes = new Map<string | null, number>();
  for (const row of rows) sizes.set(row.device, (sizes.get(row.device) ?? 0) + 1);
  return (device) => sizes.get(device) ?? 0;
}

// What a row's device cell says under the id: how many of the listed
// sessions share it, or nothing for a session with no device.
export function deviceCaptionOf(
  rows: readonly HasDevice[],
): (device: string | null) => string | null {
  const size = deviceSizeOf(rows);
  return (device) => (device === null ? null : deviceGroupLabel(size(device)));
}

export function deviceGroupLabel(size: number): string {
  return `${counted(size, 'session', 'sessions')} on this device`;
}
