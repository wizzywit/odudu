import type { ThemeView } from '#/features/branding-editor/types/theme';
import { describe, expect, it, vi } from 'vitest';
import {
  announceRevert,
  revertHold,
  revertLead,
  REVERT_CONFLICT_LEAD,
  REVERT_KEEP_HINT,
  REVERT_TAKE_HINT,
  revertConflicts,
  revertAnswered,
  revertDefected,
  revertAnswerOf,
  revertProblem,
  revertSection,
  shownRevertConflicts,
  revertRequest,
  tabUnsaved,
  revertUnsaved,
} from '#/features/branding-editor/services/revertDraft';
import { EMPTY, LOGO_ID, OWN_LIGHT, themeView } from '#/testing/brandingFixtures';

const NO_DRAFT = themeView() as ThemeView;

function viewOf(draft: object | null, published: object | null, changed: string[]): ThemeView {
  return themeView({
    draft,
    published:
      published === null
        ? null
        : { id: 'v1', version: 1, published_at: '2026-10-20T09:00:00.000Z', body: published },
    changed,
  }) as ThemeView;
}

describe('reverting a tab', () => {
  const published = { ...EMPTY, tokens: { light: OWN_LIGHT }, stylesheet: '.a { }' };
  const draft = {
    tokens: { light: { ...OWN_LIGHT, inkPrimary: '#000000' } },
    stylesheet: '.b { }',
    templates: { 'sign-in': 'x' },
    assets: { logo: { assetId: LOGO_ID, alt: 'Acme' } },
  };
  const both = viewOf(draft, published, ['tokens', 'assets', 'stylesheet', 'templates']);

  it('takes the Theme tab’s pieces from the published theme and leaves the templates', () => {
    expect(revertRequest(both, 'theme')).toEqual({
      tokens: published.tokens,
      stylesheet: '.a { }',
      assets: {},
      templates: { 'sign-in': 'x' },
    });
  });

  it('takes the Pages tab’s templates and leaves the rest of the draft', () => {
    expect(revertRequest(both, 'pages')).toEqual({ ...draft, templates: {} });
  });

  it('clears the pieces when nothing is published', () => {
    const unpublished = viewOf(draft, null, ['tokens', 'assets', 'stylesheet', 'templates']);
    expect(revertRequest(unpublished, 'theme')).toEqual({
      tokens: {},
      stylesheet: null,
      assets: {},
      templates: { 'sign-in': 'x' },
    });
  });

  it('is held when the tab has no change, and says so', () => {
    const onlyTemplates = viewOf(draft, published, ['templates']);
    expect(revertHold({ view: onlyTemplates, tab: 'theme', unsaved: [] })).toBe(
      'This tab already matches what is published.',
    );
    expect(revertHold({ view: onlyTemplates, tab: 'pages', unsaved: [] })).toBeUndefined();
    expect(revertHold({ view: NO_DRAFT, tab: 'pages', unsaved: [] })).toBe(
      'This tab already matches what is published.',
    );
  });

  it('is held while the tab holds unsaved edits, naming their sections', () => {
    expect(revertHold({ view: both, tab: 'theme', unsaved: ['Images', 'Stylesheet'] })).toBe(
      'Save your changes first, in “Images” and “Stylesheet”: reverting works on the saved draft.',
    );
  });

  it('counts only the unsaved sections of its own tab', () => {
    const dirty = new Set(['images', 'templates']);
    expect(tabUnsaved('theme', dirty)).toEqual(['Images']);
    expect(tabUnsaved('pages', dirty)).toEqual(['Page templates']);
    expect(tabUnsaved('pages', new Set())).toEqual([]);
  });
});

describe('what a revert says it takes back', () => {
  it('names the three parts of the Theme tab together, and the templates for Pages', () => {
    const tenant = { kind: 'tenant' } as const;
    expect(revertLead(tenant, 'theme')).toMatch(
      /the colours and font, the images and the stylesheet as published, all together/u,
    );
    expect(revertLead(tenant, 'pages')).toMatch(/the page templates as published/u);
    expect(revertLead({ kind: 'client', id: 'c' }, 'theme')).toMatch(/falls back to the tenant’s/u);
  });
});

describe('what a revert answers', () => {
  const done = { ok: true as const, status: 200, data: undefined, etag: null, next: null };

  it('says nothing under the button and a toast when it went through', () => {
    const toast = vi.fn();
    announceRevert(done, toast);
    expect(toast).toHaveBeenCalledWith('Tab reverted to published');
    expect(revertProblem(done)).toBeNull();
  });

  it('says what went wrong, and no toast, when it did not', () => {
    const toast = vi.fn();
    const stale = {
      ok: false as const,
      kind: 'problem' as const,
      problem: { type: 'about:blank', title: 'Precondition Failed', status: 412 },
    };
    announceRevert(stale, toast);
    expect(toast).not.toHaveBeenCalled();
    expect(revertProblem(stale)).toMatch(/Somebody saved the draft/u);
  });
});

describe('a revert that met a newer draft', () => {
  const published = { ...EMPTY, tokens: { light: OWN_LIGHT } };
  const draft = {
    ...EMPTY,
    tokens: { light: OWN_LIGHT, font: 'IBM Plex Mono' },
    assets: { logo: { assetId: LOGO_ID, alt: 'Acme' } },
    stylesheet: 'a{}',
  };

  it('names the pieces of the tab the revert would overwrite, theirs beside the published', () => {
    const conflicts = revertConflicts(viewOf(draft, published, ['tokens']), 'theme');
    expect(conflicts.map((c) => [c.field, c.label])).toEqual([
      ['tokens', 'Colours and font'],
      ['assets', 'Images'],
      ['stylesheet', 'Stylesheet'],
    ]);
    const shown = conflicts.map((c) => [c.describe?.(c.theirs), c.describe?.(c.yours)]);
    expect(shown).toEqual([
      ['2 groups of colours or fonts (light, font)', '1 group of colours or fonts (light)'],
      ['1 image (logo)', 'nothing'],
      ['3 characters, starting “a{}”', 'nothing'],
    ]);
  });

  it('tells two pieces of the same size apart', () => {
    const [one] = revertConflicts(
      viewOf({ ...EMPTY, stylesheet: 'a{color:red}' }, { ...EMPTY, stylesheet: 'b{color:red}' }, [
        'stylesheet',
      ]),
      'theme',
    );
    expect(one?.describe?.(one.theirs)).not.toBe(one?.describe?.(one.yours));
  });

  it('words its own lead, not the one for fields saved by somebody else', () => {
    expect(REVERT_CONFLICT_LEAD).toMatch(/revert/iu);
    expect(REVERT_KEEP_HINT).toMatch(/published/u);
    expect(REVERT_TAKE_HINT).toMatch(/draft/u);
  });

  it('leaves out a piece that already matches, and the other tab’s pieces', () => {
    expect(revertConflicts(viewOf(published, published, []), 'theme')).toEqual([]);
    expect(revertConflicts(viewOf(draft, published, ['tokens']), 'pages')).toEqual([]);
  });

  it('shows nothing until the revert was refused', () => {
    const view = viewOf(draft, published, ['tokens']);
    expect(shownRevertConflicts(false, view, 'theme')).toEqual([]);
    expect(shownRevertConflicts(true, view, 'theme')).toHaveLength(3);
  });

  it('names the tab as the panel’s heading reads it', () => {
    expect(revertSection('theme')).toBe('the Theme tab');
    expect(revertSection('pages')).toBe('the Pages tab');
  });
});

describe('a revert’s answer belongs to the tab it reverted', () => {
  const stale = {
    ok: false as const,
    kind: 'problem' as const,
    problem: { type: 'about:blank', title: 'Precondition Failed', status: 412 },
  };

  it('shows the problem and the stale comparison on the tab that was reverted', () => {
    const answer = revertAnswered('pages', stale);
    expect(revertAnswerOf(answer, 'pages')).toEqual({
      problem: expect.stringMatching(/Somebody saved the draft/u) as string,
      stale: true,
    });
  });

  it('shows nothing on the other tab, so Keep mine cannot revert its parts', () => {
    expect(revertAnswerOf(revertAnswered('pages', stale), 'theme')).toEqual({
      problem: null,
      stale: false,
    });
  });

  it('tells a send that threw as a defect on its own tab', () => {
    expect(revertAnswerOf(revertDefected('theme'), 'theme').stale).toBe(false);
    expect(revertAnswerOf(revertDefected('theme'), 'theme').problem).not.toBeNull();
    expect(revertAnswerOf(revertDefected('theme'), 'pages').problem).toBeNull();
  });

  it('shows nothing before any revert was answered', () => {
    expect(revertAnswerOf(null, 'theme')).toEqual({ problem: null, stale: false });
  });
});

describe('the sentence that asks for a save first', () => {
  it('names the sections and what is waiting on the saved draft', () => {
    expect(revertUnsaved(['Images', 'Stylesheet'])).toBe(
      'Save your changes first, in “Images” and “Stylesheet”: reverting works on the saved draft.',
    );
  });
});
