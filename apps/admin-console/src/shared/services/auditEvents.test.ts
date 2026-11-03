import { describe, expect, it } from 'vitest';
import { auditEvent } from '#/testing/auditFixtures';
import {
  actorNote,
  detailEntries,
  elsewhereReason,
  isElsewhere,
  previewOf,
  requestLabel,
  requestRowCounts,
  MAX_DETAIL_ENTRIES,
  PREVIEW_LENGTH,
} from '#/shared/services/auditEvents';

describe('a caller from elsewhere', () => {
  it('is a system administrator or a token another tenant issued', () => {
    expect(isElsewhere('system')).toBe(true);
    expect(isElsewhere('other-tenant')).toBe(true);
    expect(isElsewhere('tenant')).toBe(false);
    expect(isElsewhere(null)).toBe(false);
  });

  it('says why no name is shown, for each kind', () => {
    expect(elsewhereReason('system')).toMatch(/system administrator/u);
    expect(elsewhereReason('other-tenant')).toMatch(/another tenant/u);
    expect(elsewhereReason('tenant')).toBeNull();
    expect(elsewhereReason(null)).toBeNull();
  });
});

describe('request labels', () => {
  it('is short and the same every time for the same id', () => {
    expect(requestLabel('01a0ee8c-69b5-7e9b-a23c-621c22a3eb69')).toBe('request a3eb69');
    expect(requestLabel('req-7f3a9c')).toBe(requestLabel('req-7f3a9c'));
  });

  it('counts only the ids that more than one loaded row shares', () => {
    const rows = [
      auditEvent({ id: '1', request_id: 'r1' }),
      auditEvent({ id: '2', request_id: 'r1' }),
      auditEvent({ id: '3', request_id: 'r2' }),
      auditEvent({ id: '4', request_id: null }),
      auditEvent({ id: '5', request_id: null }),
    ];
    expect([...requestRowCounts(rows)]).toEqual([['r1', 2]]);
  });
});

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

describe('what is said of an actor beside its id', () => {
  it('explains a caller from elsewhere', () => {
    expect(actorNote({ actor_subject_id: 's', actor_name: null, actor_origin: 'system' })).toBe(
      elsewhereReason('system'),
    );
  });

  it('explains a missing name for an actor of this tenant', () => {
    expect(actorNote({ actor_subject_id: 's', actor_name: null, actor_origin: 'tenant' })).toMatch(
      /view-users/u,
    );
  });

  it('says nothing where the name is shown, or no subject acted', () => {
    expect(
      actorNote({ actor_subject_id: 's', actor_name: 'grace', actor_origin: 'tenant' }),
    ).toBeNull();
    expect(actorNote({ actor_subject_id: null, actor_name: null, actor_origin: null })).toBeNull();
  });
});
