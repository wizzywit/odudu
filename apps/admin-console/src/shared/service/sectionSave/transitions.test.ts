import { describe, expect, it } from 'vitest';
import {
  conflictsOf,
  discardedSection,
  editedSection,
  initialSection,
  mineKept,
  rebasedSection,
  savingSection,
  sectionBlocked,
  startable,
  theirsTaken,
  unsavedAfter,
} from '#/shared/service/sectionSave/transitions.ts';
import {
  BLOCKED_BY_CONFLICT,
  BLOCKED_GONE,
  BLOCKED_UNREAD,
  type SectionState,
} from '#/shared/service/sectionSave/state.ts';

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
});
