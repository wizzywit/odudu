import { isMissing } from '#/shared/services/failure';
import type { GatewayFailure, GatewayResult } from '#/shared/services/result';

export type RecordStatus = 'loading' | 'ready' | 'missing' | 'failed';

// What a record page shows about the read behind it, whatever the record is.
export interface RecordView {
  status: RecordStatus;
  // Somebody else changed the record since this page read it; a save made
  // here moves the record on without saying so.
  updated: boolean;
  // A read after the first failed, so what is shown may be out of date;
  // the record and every edit on it stay on screen.
  refreshFailed: boolean;
  // That read found the record deleted.
  gone: boolean;
  acknowledge: () => void;
  retry: () => void;
}

// The query parameter that names a record's tab.
export const TAB_PARAM = 'tab';

export function tabNamed<T extends string>(tabs: readonly T[], name: string | null): T | undefined {
  return tabs.find((tab) => tab === name);
}

// The tabs holding a record with unsaved edits, which carry the dot.
export function dirtyTabs<T extends string>(
  tabs: readonly T[],
  recordsOf: (tab: T) => readonly string[],
  dirty: ReadonlySet<string>,
): ReadonlySet<T> {
  return new Set(tabs.filter((tab) => recordsOf(tab).some((record) => dirty.has(record))));
}

// Where a section's unsaved edits are recorded: by tenant too, since a
// system administrator reaches the same record path in every tenant.
export function sectionKey(tenant: string, record: string, section: string): string {
  return `${tenant}/${record}#${section}`;
}

const NO_SECTIONS: ReadonlySet<string> = new Set();

// A record there is not has no section with unsaved edits.
export function sectionsOf(
  keys: Iterable<string>,
  tenant: string,
  record: string | null,
): ReadonlySet<string> {
  if (record === null) return NO_SECTIONS;
  const prefix = sectionKey(tenant, record, '');
  return new Set(
    [...keys].filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length)),
  );
}

// The newest ETag this page has taken in: the first one, and any a save of
// its own wrote, but not one somebody else's change brought.
export function seenAfter(
  seen: string | null,
  etag: string | null,
  by: 'read' | 'save' | undefined,
): string | null {
  return etag !== null && etag !== seen && (seen === null || by === 'save') ? etag : seen;
}

type RecordEntryView = { result: { etag: string | null }; by: 'read' | 'save' } | undefined;

export function entryEtag(entry: RecordEntryView): string | null {
  return entry?.result.etag ?? null;
}

// The tag a write after a read goes on: none when the read failed or gave none.
export function etagOfRead(result: GatewayResult<unknown> | null | undefined): string | null {
  return result?.ok === true ? result.etag : null;
}

// A failure counts only while the read is in error.
export function shownFailure(
  isError: boolean,
  failure: GatewayFailure | null,
): GatewayFailure | null {
  return isError ? failure : null;
}

export function recordView(
  entry: RecordEntryView,
  failure: GatewayFailure | null,
  seen: string | null,
): Pick<RecordView, 'status' | 'updated' | 'gone' | 'refreshFailed'> {
  const etag = entryEtag(entry);
  const missing = failure !== null && isMissing(failure);
  let status: RecordStatus = 'loading';
  if (entry !== undefined) status = 'ready';
  else if (failure !== null) status = missing ? 'missing' : 'failed';
  return {
    status,
    updated: etag !== null && seen !== null && etag !== seen,
    refreshFailed: entry !== undefined && failure !== null,
    gone: entry !== undefined && missing,
  };
}

// Which of `records` have a section with unsaved edits among `keys`.
export function recordsWithEdits(
  keys: Iterable<string>,
  tenant: string,
  records: readonly string[],
): ReadonlySet<string> {
  const held = [...keys];
  return new Set(
    records.filter((record) => {
      const prefix = sectionKey(tenant, record, '');
      return held.some((key) => key.startsWith(prefix));
    }),
  );
}
