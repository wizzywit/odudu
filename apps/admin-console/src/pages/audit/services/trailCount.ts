import type { AuditEvent } from '#/entities/audit-event';
import { counted } from '#/shared/lib/services/format';
import { formatInZone } from '#/shared/lib/services/zones';

// The trail has no count, so the page says what it does know: how far back
// the rows read so far reach.
export function loadedRange(
  rows: readonly Pick<AuditEvent, 'occurred_at'>[],
  zone: string,
): string | null {
  const newest = rows.at(0);
  const oldest = rows.at(-1);
  if (newest === undefined || oldest === undefined) return null;
  const at = (iso: string): string => formatInZone(new Date(iso), zone);
  const loaded = `${counted(rows.length, 'event', 'events')} loaded`;
  if (rows.length === 1) return `${loaded}, at ${at(newest.occurred_at)}.`;
  return `${loaded}, from ${at(newest.occurred_at)} back to ${at(oldest.occurred_at)}.`;
}
