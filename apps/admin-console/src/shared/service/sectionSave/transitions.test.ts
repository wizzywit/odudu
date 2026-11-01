import { describe, expect, it } from 'vitest';
import {
  canKeepMine,
  canStart,
  canSubmit,
  canTakeTheirs,
  changedFields,
  conflictsOf,
  currentSection,
  editedSection,
  discardedSection,
  hasEdits,
  initialSection,
  isSaving,
  mineKept,
  rebasedSection,
  restoredShown,
  savingSection,
  sectionBlocked,
  settlesAfter,
  startable,
  statusOf,
  theirsTaken,
  unsavedAfter,
  valuesOf,
} from '#/shared/service/sectionSave/transitions';
import {
  BLOCKED_BY_CONFLICT,
  BLOCKED_GONE,
  BLOCKED_UNREAD,
  type SectionState,
} from '#/shared/service/sectionSave/state';

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
    refusals: {},
    message: null,
    ...extra,
  };
}

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
  it('editing a field drops its refusals, positions included, and keeps the others', () => {
    const at = { path: 'name', message: 'bad', line: 2 };
    const other = { path: 'tags', message: 'worse', line: 4 };
    const next = editedSection(state({ refusals: { name: [at], tags: [other] } }), 'name', 'b');
    expect(next.refusals).toEqual({ tags: [other] });
    expect(discardedSection(state({ refusals: { name: [at] } })).refusals).toEqual({});
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
});

describe('what the section shows of its state', () => {
  it('has edits once any field differs, and names them', () => {
    expect(hasEdits({})).toBe(false);
    expect(hasEdits({ name: 'b' })).toBe(true);
    expect(changedFields(state({ edits: { name: 'b', tags: [] } }))).toEqual(['name', 'tags']);
    expect(changedFields(state())).toEqual([]);
  });

  it('shows the edits over the base, field by field', () => {
    expect(valuesOf(state({ edits: { name: 'b' } }))).toEqual({ name: 'b', tags: ['x'] });
    expect(valuesOf(state())).toEqual(BASE);
  });

  it('is in conflict whenever a field is, whatever the phase', () => {
    expect(statusOf(state({ conflicts: ['name'], phase: 'saving' }))).toBe('conflict');
    expect(statusOf(state({ phase: 'saving' }))).toBe('saving');
    expect(statusOf(state({ phase: 'unread' }))).toBe('unread');
  });

  it('is saving only in the saving phase', () => {
    expect(isSaving(state({ phase: 'saving' }))).toBe(true);
    expect(isSaving(state({ phase: 'saved' }))).toBe(false);
  });

  it('calls a section restored while kept edits are still unsaved', () => {
    const kept = { values: { name: 'b', tags: ['x'] }, etag: 'e1' };
    expect(restoredShown(kept, state({ edits: { name: 'b' } }))).toBe(true);
    expect(restoredShown(kept, state())).toBe(false);
    expect(restoredShown(null, state({ edits: { name: 'b' } }))).toBe(false);
  });
});

describe('currentSection', () => {
  const fresh = { name: 'theirs', tags: ['x'] };

  it('starts from the record, with what a session kept', () => {
    const kept = { values: { name: 'b', tags: ['x'] }, etag: 'e1' };
    expect(currentSection(null, BASE, 'e1', kept)).toEqual(initialSection(BASE, 'e1', kept));
  });

  it('is the very state it was given while neither the read nor the ETag moved', () => {
    const was = state({ edits: { name: 'mine' } });
    expect(currentSection(was, BASE, 'e1', null)).toBe(was);
  });

  it('rebases the state onto a fresh read', () => {
    const was = state({ edits: { name: 'mine' } });
    const next = currentSection(was, fresh, 'e2', null);
    expect(next).not.toBe(was);
    expect(next).toEqual(rebasedSection(was, fresh, 'e2'));
  });
});

describe('when a section may act', () => {
  const edited = state({ edits: { name: 'b' } });
  const clashing = state({ edits: { name: 'b' }, conflicts: ['name'] });

  it('starts a save only when none is in flight, and the state allows it', () => {
    expect(canStart(edited, false, false)).toBe(true);
    expect(canStart(edited, false, true)).toBe(false);
    expect(canStart(edited, true, false)).toBe(false);
    expect(canStart(state(), false, false)).toBe(false);
  });

  it('submits only with no conflict left to decide', () => {
    expect(canSubmit(edited, false, false)).toBe(true);
    expect(canSubmit(clashing, false, false)).toBe(false);
    expect(canSubmit(edited, false, true)).toBe(false);
    expect(canSubmit(state(), false, false)).toBe(false);
  });

  it('keeps its own edits only to settle a conflict, and as a save could start', () => {
    expect(canKeepMine(clashing, false, false)).toBe(true);
    expect(canKeepMine(edited, false, false)).toBe(false);
    expect(canKeepMine(clashing, false, true)).toBe(false);
    expect(canKeepMine(clashing, true, false)).toBe(false);
  });

  it('takes theirs only to settle a conflict, and not while a save is in flight', () => {
    expect(canTakeTheirs(clashing, false)).toBe(true);
    expect(canTakeTheirs(edited, false)).toBe(false);
    expect(canTakeTheirs(clashing, true)).toBe(false);
  });

  it('settles a kept draft once taking theirs leaves no edit', () => {
    expect(settlesAfter(state())).toBe(true);
    expect(settlesAfter(edited)).toBe(false);
  });
});
