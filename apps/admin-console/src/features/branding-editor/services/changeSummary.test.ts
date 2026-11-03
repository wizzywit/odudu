import type { ThemeView } from '#/features/branding-editor/types/theme';
import { describe, expect, it } from 'vitest';
import {
  barText,
  changeBrief,
  changeCount,
  changedText,
  tabsChanged,
} from '#/features/branding-editor/services/changeSummary';
import { EMPTY, themeView } from '#/testing/brandingFixtures';

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

  it('is told in a few words where the bar has room for no more', () => {
    expect(changeBrief(NO_DRAFT)).toBe('No draft');
    expect(changeBrief(viewOf(EMPTY, EMPTY, []))).toBe('Up to date');
    expect(changeBrief(viewOf(EMPTY, EMPTY, ['tokens', 'assets']))).toBe('2 changes');
  });

  it('gives each tab a dot for the pieces of the change it holds', () => {
    expect([...tabsChanged(['tokens'])]).toEqual(['theme']);
    expect([...tabsChanged(['assets', 'stylesheet'])]).toEqual(['theme']);
    expect([...tabsChanged(['templates'])]).toEqual(['pages']);
    expect([...tabsChanged(['tokens', 'templates'])]).toEqual(['theme', 'pages']);
    expect([...tabsChanged([])]).toEqual([]);
  });
});
