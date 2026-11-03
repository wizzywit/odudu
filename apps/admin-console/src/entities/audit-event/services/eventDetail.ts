import type { AuditEvent } from '#/entities/audit-event/types/auditEvent';
import { shortened } from '#/shared/lib/services/format';
import { isRecord } from '#/shared/lib/services/json';
import { formatInZone, localZone } from '#/shared/lib/services/zones';

// What the dialog that opens one row is called.
export const AUDIT_EVENT_TITLE = 'Audit event';

export const MAX_DETAIL_ENTRIES = 100;
export const PREVIEW_LENGTH = 120;
const MAX_DEPTH = 3;
const HANDLE_LENGTH = 8;

export interface DetailEntry {
  path: string;
  text: string;
  // A before and after pair, written "before → after".
  change: boolean;
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function scalarText(value: unknown): string {
  if (value === null || value === undefined) return 'none';
  if (value === '') return '(empty)';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return 'none';
    const simple = value.every((item) => item === null || typeof item !== 'object');
    return simple ? value.map(scalarText).join(', ') : json(value);
  }
  return json(value);
}

function isChange(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value);
  return keys.length === 2 && keys.includes('before') && keys.includes('after');
}

function entriesOf(
  value: Record<string, unknown>,
  prefix: string,
  depth: number,
): readonly DetailEntry[] {
  return Object.entries(value).flatMap(([key, each]): readonly DetailEntry[] => {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (!isRecord(each)) return [{ path, text: scalarText(each), change: false }];
    if (isChange(each)) {
      return [
        { path, text: `${scalarText(each.before)} → ${scalarText(each.after)}`, change: true },
      ];
    }
    if (depth >= MAX_DEPTH) return [{ path, text: json(each), change: false }];
    return entriesOf(each, path, depth + 1);
  });
}

// The redacted detail as text a person can read. Every value is text and
// goes to the page as text; a long list is cut, and says how much.
export function detailEntries(detail: Readonly<Record<string, unknown>>): {
  entries: readonly DetailEntry[];
  omitted: number;
} {
  const all = entriesOf(detail, '', 0);
  return {
    entries: all.slice(0, MAX_DETAIL_ENTRIES),
    omitted: Math.max(0, all.length - MAX_DETAIL_ENTRIES),
  };
}

export function hasChange(entries: readonly DetailEntry[]): boolean {
  return entries.some((entry) => entry.change);
}

export function omittedNote(omitted: number): string | null {
  return omitted === 0 ? null : `${String(omitted)} more not shown.`;
}

export function previewOf(text: string): { shown: string; truncated: boolean } {
  const shown = shortened(text, PREVIEW_LENGTH);
  return { shown, truncated: shown !== text };
}

// A value as the page shows it: cut while it is long, whole once asked for.
export function valueShown(text: string, whole: boolean): { shown: string; truncated: boolean } {
  const { shown, truncated } = previewOf(text);
  return { shown: whole ? text : shown, truncated };
}

// When a row happened, in the reader's zone and in UTC.
export function eventTimes(
  occurredAt: string,
  zone: string = localZone(),
): { local: string; utc: string } {
  const at = new Date(occurredAt);
  return { local: formatInZone(at, zone), utc: formatInZone(at, 'UTC') };
}

// What the dialog says of the row it opens, or nothing while it is shut.
export function eventDescription(event: Pick<AuditEvent, 'action' | 'outcome'> | null): string {
  return event === null ? '' : `${event.action}, ${event.outcome}`;
}

// A resource id short enough for a table cell, whole on hover and to copy.
export function resourceHandle(id: string): string {
  return shortened(id, HANDLE_LENGTH);
}
