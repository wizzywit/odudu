import { describe, expect, it, vi } from 'vitest';
import { selectOffered } from '#/features/branding/services/edits';
import { unsavedSections } from '#/features/branding/services/fields';

describe('what is marked changed', () => {
  it('names the sections with unsaved edits, in the order they sit', () => {
    expect(unsavedSections(new Set(['templates', 'stylesheet', 'colours']))).toEqual([
      'Colours and font',
      'Stylesheet',
      'Page templates',
    ]);
    expect(unsavedSections(new Set())).toEqual([]);
  });
});

describe('the tabs', () => {
  it('select a tab this area has, and nothing for another name', () => {
    const select = vi.fn<(tab: string) => void>();
    selectOffered('pages', select);
    selectOffered('languages', select);
    selectOffered('nope', select);
    expect(select.mock.calls).toEqual([['pages'], ['languages']]);
  });
});
