import { describe, expect, it } from 'vitest';
import {
  AUDIT_EVENT_TITLE,
  detailEntries,
  eventDescription,
  eventTimes,
  hasChange,
  MAX_DETAIL_ENTRIES,
  omittedNote,
  PREVIEW_LENGTH,
  previewOf,
  resourceHandle,
  valueShown,
} from '#/entities/audit-event/services/eventDetail';

describe('the detail as readable entries', () => {
  it('shows scalars as text, with null as none and an empty string named', () => {
    expect(
      detailEntries({ reason: 'builtin_admin_guarded', count: 3, on: true, gone: null, blank: '' })
        .entries,
    ).toEqual([
      { path: 'reason', text: 'builtin_admin_guarded', change: false },
      { path: 'count', text: '3', change: false },
      { path: 'on', text: 'true', change: false },
      { path: 'gone', text: 'none', change: false },
      { path: 'blank', text: '(empty)', change: false },
    ]);
  });

  it('shows a before and after pair as one change', () => {
    expect(detailEntries({ enabled: { before: true, after: false } }).entries).toEqual([
      { path: 'enabled', text: 'true → false', change: true },
    ]);
  });

  it('reads a pair with anything beside it as nested keys, so nothing is lost', () => {
    expect(
      detailEntries({ enabled: { before: true, after: false, extra: 'kept' } }).entries,
    ).toEqual([
      { path: 'enabled.before', text: 'true', change: false },
      { path: 'enabled.after', text: 'false', change: false },
      { path: 'enabled.extra', text: 'kept', change: false },
    ]);
    expect(detailEntries({ enabled: { before: true } }).entries).toEqual([
      { path: 'enabled.before', text: 'true', change: false },
    ]);
  });

  it('names nested keys by their path and lists arrays', () => {
    expect(
      detailEntries({ denied: ['manage-tenant', 'view-users'], counts: { roles: 2 } }).entries,
    ).toEqual([
      { path: 'denied', text: 'manage-tenant, view-users', change: false },
      { path: 'counts.roles', text: '2', change: false },
    ]);
  });

  it('writes what it cannot lay out as JSON, text and never markup', () => {
    const { entries } = detailEntries({ list: [{ a: 1 }], deep: { a: { b: { c: { d: 1 } } } } });
    expect(entries[0]?.text).toBe('[{"a":1}]');
    expect(entries[1]).toEqual({ path: 'deep.a.b.c', text: '{"d":1}', change: false });
  });

  it('keeps a bounded number and counts the rest', () => {
    const detail = Object.fromEntries(
      Array.from({ length: MAX_DETAIL_ENTRIES + 5 }, (_, i) => [`k${String(i)}`, i]),
    );
    const { entries, omitted } = detailEntries(detail);
    expect(entries).toHaveLength(MAX_DETAIL_ENTRIES);
    expect(omitted).toBe(5);
  });

  it('reads a pair and a list of scalars at the deepest level it lays out', () => {
    expect(
      detailEntries({ a: { b: { c: { before: 'x', after: 'y' }, list: [1, null, ''] } } }).entries,
    ).toEqual([
      { path: 'a.b.c', text: 'x → y', change: true },
      { path: 'a.b.list', text: '1, none, (empty)', change: false },
    ]);
    expect(detailEntries({ none: [] }).entries[0]?.text).toBe('none');
  });

  it('omits nothing at the bound itself', () => {
    const detail = Object.fromEntries(
      Array.from({ length: MAX_DETAIL_ENTRIES }, (_, i) => [`k${String(i)}`, i]),
    );
    expect(detailEntries(detail).omitted).toBe(0);
  });

  it('is empty for no detail', () => {
    expect(detailEntries({})).toEqual({ entries: [], omitted: 0 });
  });
});

describe('a long value', () => {
  it('is cut at the preview length and says so', () => {
    expect(previewOf('short')).toEqual({ shown: 'short', truncated: false });
    const long = 'x'.repeat(PREVIEW_LENGTH + 10);
    const cut = previewOf(long);
    expect(cut.truncated).toBe(true);
    expect(cut.shown).toHaveLength(PREVIEW_LENGTH + 1);
    expect(cut.shown.endsWith('…')).toBe(true);
  });
});

describe('what the dialog and a table cell say of a row', () => {
  it('names the dialog and describes the row it opens, or nothing while it is shut', () => {
    expect(AUDIT_EVENT_TITLE).toBe('Audit event');
    expect(eventDescription({ action: 'client.update', outcome: 'refused' })).toBe(
      'client.update, refused',
    );
    expect(eventDescription(null)).toBe('');
  });

  it("gives the time in the reader's zone and in UTC", () => {
    const { local, utc } = eventTimes('2026-09-28T13:41:05.250Z', 'Europe/Berlin');
    expect(local).not.toBe(utc);
    expect(utc).toBe(eventTimes('2026-09-28T13:41:05.250Z', 'UTC').local);
  });

  it('says whether a change is among the entries and how many were left out', () => {
    expect(hasChange(detailEntries({ a: { before: 1, after: 2 } }).entries)).toBe(true);
    expect(hasChange(detailEntries({ a: 1 }).entries)).toBe(false);
    expect(omittedNote(0)).toBeNull();
    expect(omittedNote(5)).toBe('5 more not shown.');
  });

  it('shows a long value cut until it is asked for whole', () => {
    const long = 'x'.repeat(PREVIEW_LENGTH + 10);
    expect(valueShown(long, false)).toEqual({ shown: previewOf(long).shown, truncated: true });
    expect(valueShown(long, true)).toEqual({ shown: long, truncated: true });
    expect(valueShown('short', true)).toEqual({ shown: 'short', truncated: false });
  });

  it('shortens a resource id to eight characters and an ellipsis', () => {
    expect(resourceHandle('0192f7a4-5c1e-7b3a')).toBe('0192f7a4…');
    expect(resourceHandle('c1')).toBe('c1');
  });
});
