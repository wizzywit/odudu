import { AUDIT_EXPORT_CAP } from '@odudu/contracts/admin';
import { utcDay } from '#/shared/services/dateTime';
import { groupedNumber, plural } from '#/shared/services/format';
import { isTooBroad } from '#/features/audit/services/broad';
import type { GatewayFailure } from '#/shared/services/result';

export const EXPORT_NOTE = `Exports the events the applied filters match, newest first, one JSON object per line, up to ${groupedNumber(AUDIT_EXPORT_CAP)}. Past that the export is refused rather than cut short. The export is itself recorded in the trail.`;

// The UTC day, so one export taken twice in an evening is named the same
// wherever the person is.
export function auditFileName(tenant: string, now: Date): string {
  return `${tenant}-audit-${utcDay(now)}.ndjson`;
}

export function eventsIn(text: string): number {
  return text.split('\n').filter((line) => line.trim() !== '').length;
}

export function savedText(fileName: string, events: number): string {
  return `Saved ${fileName}, ${groupedNumber(events)} ${plural(events, 'event', 'events')}.`;
}

export function exportFailureText(failure: GatewayFailure, refused: boolean): string {
  if (refused) return 'Exporting the trail needs view-audit.';
  if (isTooBroad(failure)) {
    return 'These filters could not be exported in time. Choose a time range, then export again.';
  }
  if (failure.kind === 'problem') {
    if (failure.problem.status === 413) {
      return `These filters match more than ${groupedNumber(AUDIT_EXPORT_CAP)} events, the most an export holds. Narrow the filters and export again.`;
    }
    return failure.problem.detail ?? failure.problem.title;
  }
  return 'The export could not be read. Nothing was saved; try again.';
}
