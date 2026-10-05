import { describe, expect, it } from 'vitest';
import {
  afterSave,
  changedFrom,
  conflictsOf,
  discardedSection,
  editedSection,
  fieldValues,
  initialSection,
  mineKept,
  rebasedSection,
  rereadPhase,
  saveFailureText,
  saveOutcome,
  savingSection,
  sectionBlocked,
  startable,
  theirsTaken,
  unsavedAfter,
  withoutFields,
  BLOCKED_BY_CONFLICT,
  BLOCKED_GONE,
  BLOCKED_UNREAD,
  type SectionState,
} from '#/shared/service/sectionSave.ts';
import type { GatewayFailure } from '#/shared/service/result.ts';

const BASE = { name: 'a', tags: ['x'] };
type V = typeof BASE;

function state(extra: Partial<SectionState<V>> = {}): SectionState<V> {
  return {
    base: BASE,
    etag: 'e1',
    edits: {},
    conflicts: [],
    source: 'kept',
    phase: 'idle',
    fieldErrors: {},
    message: null,
    ...extra,
  };
}

function problem(
  status: number,
  extra: { detail?: string; errors?: { path: string; message: string }[] } = {},
): GatewayFailure {
  return {
    ok: false,
    kind: 'problem',
    problem: { type: 'about:blank', title: `T${String(status)}`, status, ...extra },
  };
}

describe('the section values', () => {
  it('reads the values off the fields, and which of them an edit changed', () => {
    const fields = {
      name: { value: 'a', label: 'Name', kind: 'plain' as const },
      tags: { value: ['x'], label: 'Tags', kind: 'plain' as const },
    };
    expect(fieldValues(fields)).toEqual(BASE);
    expect(changedFrom(BASE, { name: 'b', tags: ['x'], stray: 1 })).toEqual({ name: 'b' });
    expect(withoutFields({ name: 'b', tags: [] }, ['name'])).toEqual({ tags: [] });
  });
});

describe('initialSection', () => {
  it('starts clean with nothing kept', () => {
    expect(initialSection(BASE, 'e1', null)).toEqual(state());
  });
  it('restores kept edits without conflict on the same version', () => {
    const s = initialSection(BASE, 'e1', { values: { name: 'b', tags: ['x'] }, etag: 'e1' });
    expect(s.edits).toEqual({ name: 'b' });
    expect(s.conflicts).toEqual([]);
  });
  it('shows every kept edit beside the record when the version has moved on', () => {
    const s = initialSection(BASE, 'e2', { values: { name: 'b', tags: ['x'] }, etag: 'e1' });
    expect(s.conflicts).toEqual(['name']);
    expect(s.source).toBe('kept');
  });
});

describe('rebasedSection', () => {
  it('is unchanged while the read and the ETag are the same', () => {
    expect(rebasedSection(state(), BASE, 'e1')).toBeNull();
  });
  it('carries edits onto a fresh read, and flags what was changed there too', () => {
    const was = state({ edits: { name: 'mine' } });
    const next = rebasedSection(was, { name: 'theirs', tags: ['x'] }, 'e2');
    expect(next).toMatchObject({
      etag: 'e2',
      edits: { name: 'mine' },
      conflicts: ['name'],
      source: 'changed',
    });
  });
  it('keeps the earlier conflicts that still have an edit, without repeating one', () => {
    const was = state({ edits: { name: 'mine' }, conflicts: ['name'], source: 'kept' });
    const next = rebasedSection(was, { name: 'theirs', tags: ['x'] }, 'e2');
    expect(next?.conflicts).toEqual(['name']);
  });
  it('turns an unread record into a stale one once a newer ETag arrives', () => {
    expect(rebasedSection(state({ phase: 'unread' }), BASE, 'e2')?.phase).toBe('stale');
    expect(rebasedSection(state({ phase: 'saving' }), BASE, 'e2')?.phase).toBe('saving');
  });
});

describe('the edit transitions', () => {
  it('editing clears that field error and the message, and goes back to idle', () => {
    const next = editedSection(
      state({ fieldErrors: { name: 'bad', tags: 'worse' }, message: 'm', phase: 'invalid' }),
      'name',
      'b',
    );
    expect(next).toMatchObject({
      edits: { name: 'b' },
      fieldErrors: { tags: 'worse' },
      message: null,
      phase: 'idle',
    });
  });
  it('a save in flight stays saving while it is edited', () => {
    expect(editedSection(state({ phase: 'saving' }), 'name', 'b').phase).toBe('saving');
  });
  it('saving, keeping mine, taking theirs and discarding', () => {
    expect(savingSection(state({ message: 'm' }))).toMatchObject({
      phase: 'saving',
      message: null,
    });
    expect(mineKept(state({ conflicts: ['name'] })).conflicts).toEqual([]);
    expect(
      theirsTaken(
        state({
          edits: { name: 'b', tags: [] },
          conflicts: ['name'],
          phase: 'stale',
          message: 'm',
        }),
      ),
    ).toMatchObject({ edits: { tags: [] }, conflicts: [], phase: 'idle', message: null });
    expect(
      discardedSection(
        state({
          edits: { name: 'b' },
          conflicts: ['name'],
          fieldErrors: { name: 'x' },
          message: 'm',
          phase: 'failed',
        }),
      ),
    ).toEqual(state());
  });
});

describe('what a save leaves', () => {
  it('keeps the edits made while it was in flight', () => {
    expect(unsavedAfter({ name: 'b', tags: ['y'] }, { name: 'b', tags: ['x'] })).toEqual({
      tags: ['y'],
    });
  });
  it('starts only when idle, with edits, and not gone or unread', () => {
    expect(startable(state({ edits: { name: 'b' } }), false)).toBe(true);
    expect(startable(state(), false)).toBe(false);
    expect(startable(state({ edits: { name: 'b' } }), true)).toBe(false);
    expect(startable(state({ edits: { name: 'b' }, phase: 'unread' }), false)).toBe(false);
  });
  it('says why Save is held', () => {
    expect(sectionBlocked(true, 1, 'idle')).toBe(BLOCKED_GONE);
    expect(sectionBlocked(false, 1, 'idle')).toBe(BLOCKED_BY_CONFLICT);
    expect(sectionBlocked(false, 0, 'unread')).toBe(BLOCKED_UNREAD);
    expect(sectionBlocked(false, 0, 'idle')).toBeUndefined();
  });
  it('projects the conflicts with the labels and the secret mark', () => {
    const fields = {
      name: { value: 'theirs', label: 'Name', kind: 'plain' as const },
      tags: { value: ['x'], label: 'Tags', kind: 'secret' as const },
    };
    const list = conflictsOf(
      state({
        base: { name: 'theirs', tags: ['x'] },
        edits: { name: 'mine' },
        conflicts: ['name', 'tags'],
      }),
      fields,
    );
    expect(list.map((c) => [c.field, c.label, c.theirs, c.yours, c.secret])).toEqual([
      ['name', 'Name', 'theirs', 'mine', false],
      ['tags', 'Tags', ['x'], undefined, true],
    ]);
  });
  it('settles on the phase of the outcome, and clears what was saved', () => {
    const saved = afterSave(
      state({ edits: { name: 'b', tags: ['y'] }, fieldErrors: { name: 'old' } }),
      { phase: 'saved', fieldErrors: {}, refetch: false, refused: false },
      { name: 'b', tags: ['x'] },
    );
    expect(saved).toMatchObject({ phase: 'saved', edits: { tags: ['y'] }, fieldErrors: {} });
    const refused = afterSave(
      state({ edits: { name: 'b' } }),
      { phase: 'refused', message: 'no', refetch: false, refused: true },
      { name: 'b' },
    );
    expect(refused).toMatchObject({ phase: 'refused', message: 'no', edits: { name: 'b' } });
  });
});

describe('saveOutcome', () => {
  const ctx = { label: 'Settings', capability: 'manage-tenant', fields: ['name'] };
  const ok = { ok: true as const, status: 200, data: null, etag: 'e', next: null };

  it('toasts a save', () => {
    expect(saveOutcome(ok, ctx)).toEqual({
      phase: 'saved',
      fieldErrors: {},
      toast: { tone: 'success', message: 'Settings saved' },
      refetch: false,
      refused: false,
    });
  });
  it('re-reads after a 412, and does nothing visible for a 401', () => {
    expect(saveOutcome(problem(412), ctx)).toMatchObject({ phase: 'stale', refetch: true });
    expect(saveOutcome(problem(401), ctx)).toMatchObject({ phase: 'idle', refetch: false });
    expect(rereadPhase(true)).toBe('unread');
    expect(rereadPhase(false)).toBe('stale');
  });
  it('places a 400 under its fields and toasts what has no field', () => {
    const rejected = problem(400, {
      errors: [
        { path: 'name', message: 'long' },
        { path: 'zzz', message: 'odd' },
      ],
    });
    expect(saveOutcome(rejected, ctx)).toMatchObject({
      phase: 'invalid',
      fieldErrors: { name: 'long' },
      toast: { tone: 'error', message: 'Settings was not saved: zzz: odd' },
    });
    const bare = saveOutcome(problem(400, { errors: [{ path: 'name', message: 'long' }] }), ctx);
    expect(bare.toast).toBeUndefined();
  });
  it('words a 409 and a 403, the explanation first', () => {
    expect(saveOutcome(problem(409, { detail: 'guard' }), ctx)).toMatchObject({
      phase: 'refused',
      message: 'guard',
    });
    expect(saveOutcome(problem(409), { ...ctx, explain: () => 'explained' }).message).toBe(
      'explained',
    );
    expect(saveOutcome(problem(403), ctx)).toMatchObject({
      phase: 'refused',
      message: 'Settings was not saved: it needs the manage-tenant capability.',
      refused: true,
    });
    expect(saveOutcome(problem(403), { ...ctx, explain: () => 'explained' }).message).toBe(
      'explained',
    );
  });
  it('fails with a toast for anything else', () => {
    expect(saveOutcome({ ok: false, kind: 'defect' }, ctx)).toMatchObject({
      phase: 'failed',
      toast: { tone: 'error', message: saveFailureText('Settings', { ok: false, kind: 'defect' }) },
    });
  });
});

describe('saveFailureText', () => {
  it('says what is known and what to do', () => {
    expect(saveFailureText('Settings', { ok: false, kind: 'network' })).toBe(
      'Could not confirm that Settings was saved. Your changes are still here, and saving again is safe.',
    );
    expect(saveFailureText('Settings', { ok: false, kind: 'schema' })).toBe(
      'Settings may have been saved, but its answer could not be read. Reload to check.',
    );
    expect(saveFailureText('Settings', { ok: false, kind: 'defect' })).toBe(
      'The console could not save Settings. This is a fault in the console, not something you did.',
    );
    expect(saveFailureText('Settings', problem(404))).toBe(
      'Settings was not saved: it no longer exists.',
    );
    expect(saveFailureText('Settings', problem(500, { detail: 'boom' }))).toBe(
      'Settings was not saved: boom',
    );
  });
});
