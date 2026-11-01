import type { ThemeView } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import {
  PROBLEMS_SHOWN,
  issueLine,
  issuesOf,
  limitedIssues,
  publishedText,
  publishHold,
  publishOutcomeOf,
  refusalText,
  warningLines,
} from '#/features/branding/service';
import { draftedView, themeView } from '#/testing/brandingFixtures';

const drafted = draftedView() as ThemeView;
const bare = themeView() as ThemeView;

describe('what holds Publish', () => {
  it('names unsaved edits first, then a missing draft, then nothing to publish, then contrast', () => {
    const where = ['Colours and font', 'Page templates'];
    expect(publishHold({ view: bare, unsaved: where, contrast: 'c' })).toBe(
      'Save your changes first, in “Colours and font” and “Page templates”: publishing uses the saved draft.',
    );
    expect(publishHold({ view: bare, unsaved: [], contrast: 'c' })).toMatch(/no draft/u);
    const unchanged = { ...drafted, changed: [] } as ThemeView;
    expect(publishHold({ view: unchanged, unsaved: [], contrast: 'c' })).toBe(
      'Nothing to publish: the draft matches what people see.',
    );
    expect(publishHold({ view: drafted, unsaved: [], contrast: 'c' })).toBe('c');
    expect(publishHold({ view: drafted, unsaved: [], contrast: undefined })).toBeUndefined();
  });
});

describe('the status', () => {
  it('says what is published and what is waiting', () => {
    expect(publishedText(bare)).toMatch(/Nothing published yet/u);
    expect(publishedText(drafted)).toBe('Version 1 is published.');
  });
});

describe('what the server refused', () => {
  it('is a line with its path and, for text, its place', () => {
    expect(issueLine({ path: 'a.b', message: 'bad' })).toBe('a.b: bad');
    expect(issueLine({ path: 'templates.x', message: 'bad', line: 2 })).toBe(
      'templates.x: bad (line 2)',
    );
    expect(issueLine({ path: 't', message: 'm', line: 2, column: 9 })).toBe(
      't: m (line 2, column 9)',
    );
  });

  it('shows at most twenty and says how many more', () => {
    const errors = Array.from({ length: 100 }, (_, i) => ({ path: `p${String(i)}`, message: 'm' }));
    const shown = issuesOf(errors);
    expect(shown.lines).toHaveLength(PROBLEMS_SHOWN);
    expect(shown.more).toBe('and 80 more problems');
    expect(issuesOf(undefined)).toEqual({ lines: [], more: null });
  });

  it('cuts a field’s joined refusals the same way', () => {
    const text = Array.from({ length: 30 }, (_, i) => `e${String(i)}`).join('; ');
    expect(limitedIssues(text)).toMatch(/; and 10 more problems$/u);
    expect(limitedIssues('one; two')).toBe('one; two');
    expect(limitedIssues(undefined)).toBeUndefined();
  });

  it('is worded per problem type for a publish or a restore', () => {
    const type = (suffix: string, status = 409) => ({
      type: `about:blank#${suffix}`,
      title: 't',
      status,
    });
    expect(refusalText(type('theme-no-draft'), 'published')).toMatch(/no draft/u);
    expect(refusalText(type('theme-nothing-to-publish'), 'published')).toMatch(
      /Nothing to publish/u,
    );
    expect(refusalText(type('theme-assets-missing'), 'restored')).toMatch(/image it names/u);
    expect(refusalText(type('theme-version-fails-checks'), 'restored')).toMatch(/today’s checks/u);
    expect(refusalText(type('x', 400), 'published')).toMatch(/Fix what is listed/u);
    expect(refusalText(type('x', 500), 'published')).toBeNull();
  });

  it('carries the warnings of a publish that went through', () => {
    const response = {
      ...drafted,
      warnings: [{ piece: 'stylesheet', code: 'stylesheet-unverified' as const, message: 'm' }],
    };
    expect(warningLines(response)).toEqual(['stylesheet: m']);
    expect(
      publishOutcomeOf(
        { ok: true, status: 200, data: response, etag: null, next: null },
        () => '',
        '"d1"',
      ).warnings,
    ).toEqual(['stylesheet: m']);
  });
});
