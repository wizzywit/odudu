import type { ThemeView } from '@odudu/contracts/admin';
import { describe, expect, it, vi } from 'vitest';
import {
  announceRevert,
  barText,
  changeCount,
  changedText,
  DISCARD_BODY_TENANT,
  discardBody,
  discardFailure,
  NOTHING_TO_PUBLISH,
  revertHold,
  revertLead,
  revertProblem,
  revertRequest,
  tabsChanged,
  tabUnsaved,
  writeCapability,
} from '#/features/branding/service';
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

describe('what differs', () => {
  it('is named by the sections that hold it, in the order they sit on the tabs', () => {
    expect(changedText(viewOf(EMPTY, null, ['templates', 'tokens']))).toBe(
      'Changed: Colours and font, Page templates',
    );
    expect(changedText(viewOf(EMPTY, null, ['stylesheet', 'assets']))).toBe(
      'Changed: Images, Stylesheet',
    );
  });

  it('says nothing when nothing differs', () => {
    expect(changedText(viewOf(EMPTY, EMPTY, []))).toBeNull();
    expect(changedText(NO_DRAFT)).toBeNull();
  });

  it('is told by the bar as what is published and what is waiting', () => {
    expect(barText(NO_DRAFT)).toBe('No draft.');
    expect(barText(viewOf(EMPTY, EMPTY, []))).toBe('The draft matches what people see.');
    expect(barText(viewOf(EMPTY, EMPTY, ['tokens']))).toBe('Changed: Colours and font');
  });

  it('is told in a count where the bar has one line, the sentence kept for a title', () => {
    expect(changeCount(NO_DRAFT)).toBeNull();
    expect(changeCount(viewOf(EMPTY, EMPTY, []))).toBeNull();
    expect(changeCount(viewOf(EMPTY, EMPTY, ['tokens']))).toBe('1 change');
    expect(changeCount(viewOf(EMPTY, EMPTY, ['tokens', 'assets', 'templates']))).toBe('3 changes');
  });

  it('gives each tab a dot for the pieces of the change it holds', () => {
    expect([...tabsChanged(['tokens'])]).toEqual(['theme']);
    expect([...tabsChanged(['assets', 'stylesheet'])]).toEqual(['theme']);
    expect([...tabsChanged(['templates'])]).toEqual(['pages']);
    expect([...tabsChanged(['tokens', 'templates'])]).toEqual(['theme', 'pages']);
    expect([...tabsChanged([])]).toEqual([]);
  });
});

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

describe('discarding the draft', () => {
  it('says published stays, unlike a reset, in the scope’s words', () => {
    expect(discardBody({ kind: 'tenant' })).toBe(DISCARD_BODY_TENANT);
    expect(DISCARD_BODY_TENANT).toMatch(/people keep seeing it/u);
    expect(discardBody({ kind: 'client', id: 'c1' })).toMatch(/client/u);
  });

  it('words a failure like the other writes', () => {
    expect(discardFailure({ ok: false, kind: 'network' })).toMatch(/discard/u);
  });
});

describe('the hold for nothing to publish', () => {
  it('is the sentence the server’s refusal says too', () => {
    expect(NOTHING_TO_PUBLISH).toBe('Nothing to publish: the draft matches what people see.');
  });
});

describe('the capability a scope’s writes need', () => {
  it('is manage-tenant for the tenant and manage-clients for a client', () => {
    expect(writeCapability({ kind: 'tenant' })).toBe('manage-tenant');
    expect(writeCapability({ kind: 'client', id: 'c1' })).toBe('manage-clients');
  });
});
