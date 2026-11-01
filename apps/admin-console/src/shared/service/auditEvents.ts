import type { AuditEvent } from '@odudu/contracts/admin';
import { shortened } from '#/shared/service/format';

type Origin = AuditEvent['actor_origin'];

export function isElsewhere(origin: Origin): boolean {
  return origin === 'system' || origin === 'other-tenant';
}

// Why a caller from elsewhere has no name here: the API resolves a name only
// within the row's own tenant (ADR 0037).
export function elsewhereReason(origin: Origin): string | null {
  if (origin === 'system') {
    return 'A system administrator acting across tenants. Its tenant is the system tenant, not this one, so this tenant cannot name it; its id is shown instead.';
  }
  if (origin === 'other-tenant') {
    return "A token issued by another tenant, presented here and refused. This tenant cannot resolve another tenant's subject to a name; its id is shown instead.";
  }
  return null;
}

const NAME_NOT_SHOWN =
  'A name is shown only to a caller who holds view-users, and only while the subject still exists; the id is always here.';

// What a reader needs to know about an actor besides who it is, where the row
// cannot say it: why there is no name.
export function actorNote(
  event: Pick<AuditEvent, 'actor_subject_id' | 'actor_name' | 'actor_origin'>,
): string | null {
  if (event.actor_subject_id === null) return null;
  const reason = elsewhereReason(event.actor_origin);
  if (reason !== null) return reason;
  return event.actor_name === null ? NAME_NOT_SHOWN : null;
}

export const ELSEWHERE_NOTE =
  'Marked from elsewhere: the caller’s tenant is not this one, so this tenant cannot name them. It is a system administrator acting across tenants, or a token another tenant issued and this one refused.';

const LABEL_LENGTH = 6;

// A request id as a short handle the same id always has, so two rows read as
// one request without comparing 36 characters.
export function requestLabel(id: string): string {
  return `request ${id.slice(-LABEL_LENGTH)}`;
}

// The ids more than one of these rows carry, with how many do. Only the rows
// loaded are counted: the API cannot filter by request.
export function requestRowCounts(
  events: readonly Pick<AuditEvent, 'request_id'>[],
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const { request_id: id } of events) {
    if (id !== null) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return new Map([...counts].filter(([, count]) => count > 1));
}

export const CORRELATION_NOTE =
  'Rows with the same request id were written for one request, and are labelled as such. The server cannot filter by request, so a label groups only the rows loaded here. The caller can set the id, so it is a correlation, not evidence.';

export const MAX_DETAIL_ENTRIES = 100;
export const PREVIEW_LENGTH = 120;
const MAX_DEPTH = 3;

export interface DetailEntry {
  path: string;
  text: string;
  // A before and after pair, written "before → after".
  change: boolean;
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

export function previewOf(text: string): { shown: string; truncated: boolean } {
  const shown = shortened(text, PREVIEW_LENGTH);
  return { shown, truncated: shown !== text };
}
