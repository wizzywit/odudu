import { describe, expect, it } from 'vitest';
import {
  conflictFields,
  conflictSection,
  conflictsIn,
  editedOverride,
  EMPTY_OVERRIDE,
  filledOverride,
  formAfterSave,
  formAfterTakingTheirs,
  keepMine,
  overrideConflict,
  overrideFailure,
  afterSave,
  removeOutcome,
  staleOutcome,
  STALE_REMOVAL,
  UNREAD_NEWER,
  withConflict,
  withoutConflict,
} from '#/features/branding/service';
import type { GatewayFailure } from '#/shared/service/result';

const refused = (status: number, type: string): GatewayFailure => ({
  ok: false,
  kind: 'problem',
  problem: { type, status, title: 'Refused' },
});

describe('two administrators and one override', () => {
  const sent = { locale: 'en', key: 'login.title', message: 'Mine' };

  it('reads a 412 on a save as a conflict to show, not as a message', () => {
    const outcome = overrideFailure(refused(412, 'about:blank'));
    expect(outcome).toMatchObject({ stale: true, message: null, errors: {}, report: false });
    const after = afterSave(refused(412, 'about:blank'), sent, EMPTY_OVERRIDE);
    expect(after.stale).toBe(true);
    expect(after.toast).toBeNull();
  });

  it('does not read any other refusal as one', () => {
    expect(overrideFailure(refused(409, 'about:blank#message-overrides-full')).stale).toBe(false);
    expect(overrideFailure({ ok: false, kind: 'network' }).stale).toBe(false);
  });

  it('keeps the version a form was filled from until another key is typed', () => {
    const filled = filledOverride({ key: 'login.title', message: 'Hi', etag: '"v1"' });
    expect(editedOverride(filled, 'message', 'Hello').etag).toBe('"v1"');
    expect(editedOverride(filled, 'key', 'login.help')).toMatchObject({
      key: 'login.help',
      etag: null,
    });
  });

  it('shows their text beside mine, and offers theirs version to keep mine on', () => {
    const conflict = overrideConflict(sent, { message: 'Theirs', etag: '"t"' });
    expect(conflictFields(conflict)).toEqual([
      { field: 'message', label: 'Text', theirs: 'Theirs', yours: 'Mine', secret: false },
    ]);
    expect(conflictSection(conflict)).toBe('the en text for login.title');
    expect(keepMine(conflict)).toEqual({ ...sent, etag: '"t"' });
  });

  it('keeps mine as a create when theirs removed the override', () => {
    const conflict = overrideConflict(sent, null);
    expect(conflictFields(conflict)[0]?.theirs).toBeNull();
    expect(keepMine(conflict).etag).toBeNull();
  });

  it('holds one conflict per override, and the language shown only', () => {
    const one = overrideConflict(sent, { message: 'A', etag: '"a"' });
    const again = overrideConflict(sent, { message: 'B', etag: '"b"' });
    const other = overrideConflict({ ...sent, key: 'login.help' }, null);
    const fr = overrideConflict({ ...sent, locale: 'fr' }, null);
    const held = withConflict(withConflict(withConflict([one], other), again), fr);
    expect(held).toHaveLength(3);
    expect(held.find((c) => c.key === 'login.title' && c.locale === 'en')?.theirs).toBe('B');
    expect(conflictsIn(held, 'en')).toHaveLength(2);
    expect(withoutConflict(held, one)).toHaveLength(2);
  });

  it('empties a form that still holds the edit dropped by taking theirs, and no other', () => {
    const conflict = overrideConflict(sent, null);
    expect(
      formAfterTakingTheirs({ key: 'login.title', message: 'x', etag: null }, conflict),
    ).toEqual(EMPTY_OVERRIDE);
    const other = { key: 'login.help', message: 'x', etag: null };
    expect(formAfterTakingTheirs(other, conflict)).toBe(other);
  });

  it('tells a stale removal to look again, and still counts a gone one as done', () => {
    expect(removeOutcome(refused(412, 'about:blank'))).toEqual({
      done: false,
      text: STALE_REMOVAL,
    });
    expect(removeOutcome(refused(404, 'about:blank')).done).toBe(true);
  });

  it('turns the override read after a 412 into the comparison, or says it could not be read', () => {
    const current = { ok: true as const, status: 200, data: null, etag: null, next: null };
    expect(staleOutcome(sent, current)).toEqual({
      conflict: overrideConflict(sent, null),
      message: null,
    });
    expect(staleOutcome(sent, { ok: false, kind: 'network' })).toEqual({
      conflict: null,
      message: UNREAD_NEWER,
    });
  });

  it('empties the form that carried a saved edit and leaves one that did not', () => {
    const typed = { key: 'login.help', message: 'x', etag: null };
    expect(formAfterSave(typed, { key: 'login.help' }, true)).toEqual(EMPTY_OVERRIDE);
    expect(formAfterSave(typed, { key: 'login.title' }, true)).toBe(typed);
    expect(formAfterSave(typed, { key: 'login.help' }, false)).toBe(typed);
  });
});
