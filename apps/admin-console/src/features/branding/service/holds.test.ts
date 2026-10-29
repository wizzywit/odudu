import type { ThemeView } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import {
  discardNote,
  foldedActions,
  publicationHolds,
  runningLine,
  writesRunning,
  type WritesRunning,
} from '#/features/branding/service/holds';
import { EMPTY, themeView } from '#/testing/brandingFixtures';

const IDLE: WritesRunning = { publish: false, discard: false, revert: false, saving: false };
const NOTHING_UNSAVED = { theme: [], pages: [] } as const;

function viewOf(draft: object | null, changed: string[]): ThemeView {
  return themeView({
    draft,
    published:
      draft === null
        ? null
        : { id: 'v1', version: 1, published_at: '2026-10-20T09:00:00.000Z', body: EMPTY },
    changed,
  }) as ThemeView;
}

const WAITING = viewOf(EMPTY, ['tokens', 'templates']);
const NO_DRAFT = viewOf(null, []);

function holds(
  view: ThemeView,
  extra: Partial<{
    busy: Partial<WritesRunning>;
    unsaved: string[];
    unsavedByTab: { theme: string[]; pages: string[] };
    contrast: string;
  }> = {},
) {
  return publicationHolds({
    view,
    busy: { ...IDLE, ...extra.busy },
    unsaved: extra.unsaved ?? [],
    unsavedByTab: extra.unsavedByTab ?? NOTHING_UNSAVED,
    contrast: extra.contrast,
  });
}

describe('what a running write says', () => {
  it('names what is running, in the order a person started it', () => {
    expect(runningLine(IDLE)).toBeUndefined();
    expect(runningLine({ ...IDLE, publish: true })).toBe('Publishing…');
    expect(runningLine({ ...IDLE, discard: true })).toBe('Discarding…');
    expect(runningLine({ ...IDLE, revert: true })).toBe('Reverting…');
    expect(runningLine({ ...IDLE, saving: true })).toBe('Saving…');
    expect(runningLine({ ...IDLE, revert: true, saving: true })).toBe('Reverting…');
  });
});

describe('what holds each action of the bar', () => {
  it('holds nothing when the draft is waiting and nothing is running or unsaved', () => {
    expect(holds(WAITING)).toEqual({
      publish: undefined,
      discard: undefined,
      revertTheme: undefined,
      revertPages: undefined,
    });
  });

  for (const [what, busy, line] of [
    ['publishing', { publish: true }, 'Publishing…'],
    ['discarding', { discard: true }, 'Discarding…'],
    ['reverting', { revert: true }, 'Reverting…'],
    ['saving', { saving: true }, 'Saving…'],
  ] as const) {
    it(`holds every action with one line while ${what}, whatever else is wrong`, () => {
      const all = holds(NO_DRAFT, { busy, unsaved: ['Stylesheet'], contrast: 'c' });
      expect(all).toEqual({
        publish: line,
        discard: line,
        revertTheme: line,
        revertPages: line,
      });
    });
  }

  it('holds Discard with no draft, and keeps holding it after a publish consumed the draft', () => {
    expect(holds(NO_DRAFT).discard).toBe('There is no draft to discard.');
    expect(holds(NO_DRAFT).publish).toMatch(/no draft/u);
  });

  it('holds Discard while any section has unsaved edits, and says to save or discard them', () => {
    const where = ['Colours and font', 'Page templates'];
    expect(holds(WAITING, { unsaved: where }).discard).toBe(
      'Save or discard your changes first, in “Colours and font” and “Page templates”: discarding the draft does not touch them.',
    );
    expect(holds(WAITING, { unsaved: where }).publish).toMatch(/^Save your changes first/u);
  });

  it('holds each Revert by its own tab’s unsaved edits and pieces', () => {
    const result = holds(WAITING, { unsavedByTab: { theme: ['Stylesheet'], pages: [] } });
    expect(result.revertTheme).toMatch(/^Save your changes first, in “Stylesheet”/u);
    expect(result.revertPages).toBeUndefined();
    expect(holds(viewOf(EMPTY, ['templates'])).revertTheme).toMatch(/already matches/u);
  });

  it('leaves Publish to the colours, as before', () => {
    expect(holds(WAITING, { contrast: 'Text on page is too faint.' }).publish).toBe(
      'Text on page is too faint.',
    );
  });
});

describe('what the narrow bar says and folds', () => {
  it('says a held Discard under the bar only for a reason of its own', () => {
    const unsaved = holds(WAITING, { unsaved: ['Stylesheet'] });
    expect(discardNote(unsaved, true, unsaved.publish)).toMatch(/^Save or discard/u);
    expect(discardNote(holds(NO_DRAFT), false, holds(NO_DRAFT).publish)).toBeUndefined();
    const running = holds(WAITING, { busy: { publish: true } });
    expect(discardNote(running, true, running.publish)).toBeUndefined();
    expect(discardNote(holds(WAITING), true, undefined)).toBeUndefined();
  });

  it('offers Revert only where the tab has parts to take back, with its reason when held', () => {
    const open = holds(WAITING);
    const ids = (offered: boolean) =>
      foldedActions({ holds: open, tab: 'pages', revertOffered: offered, reverting: false }).map(
        (action) => action.id,
      );
    expect(ids(true)).toEqual(['revert', 'discard']);
    expect(ids(false)).toEqual(['discard']);
    const held = foldedActions({
      holds: holds(viewOf(EMPTY, ['templates'])),
      tab: 'theme',
      revertOffered: true,
      reverting: false,
    });
    expect(held[0]).toMatchObject({ id: 'revert', isDisabled: true });
    expect(held[0]?.description).toMatch(/already matches/u);
    expect(held[1]).toMatchObject({ id: 'discard', isDisabled: false, label: 'Discard draft…' });
  });

  it('holds both under one running line, and names a revert that is running', () => {
    const busy = holds(WAITING, { busy: { revert: true } });
    const actions = foldedActions({
      holds: busy,
      tab: 'pages',
      revertOffered: true,
      reverting: true,
    });
    expect(actions.map((action) => [action.label, action.isDisabled, action.description])).toEqual([
      ['Reverting…', true, 'Reverting…'],
      ['Discard draft…', true, 'Reverting…'],
    ]);
  });
});

describe('the running writes read from counts', () => {
  const none = { publish: 0, discard: 0, revert: 0, every: 0, sections: false };

  it('names each write that is counted and nothing else', () => {
    expect(writesRunning(none)).toEqual(IDLE);
    expect(writesRunning({ ...none, publish: 1, every: 1 })).toEqual({ ...IDLE, publish: true });
    expect(writesRunning({ ...none, revert: 2, every: 2 })).toEqual({ ...IDLE, revert: true });
  });

  it('calls it saving when the tenant has a write that is not a named one, or a section saves', () => {
    expect(writesRunning({ ...none, every: 1 })).toEqual({ ...IDLE, saving: true });
    expect(writesRunning({ ...none, discard: 1, every: 2 })).toEqual({
      ...IDLE,
      discard: true,
      saving: true,
    });
    expect(writesRunning({ ...none, sections: true })).toEqual({ ...IDLE, saving: true });
  });
});
