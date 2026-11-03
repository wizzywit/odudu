import { describe, expect, it } from 'vitest';
import { unsavedSections } from '#/features/branding-editor/services/sectionTitles';

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
