import { describe, expect, it } from 'vitest';
import { unsavedBlock, unsavedSections } from '#/features/branding/services/sectionTitles';

describe('the sentence that holds an action back', () => {
  it('asks to save, naming the sections', () => {
    expect(unsavedBlock(['Images', 'Stylesheet'], 'reverting works on the saved draft')).toBe(
      'Save your changes first, in “Images” and “Stylesheet”: reverting works on the saved draft.',
    );
  });

  it('asks to save or discard where the action allows either', () => {
    expect(
      unsavedBlock(['Images'], 'discarding the draft does not touch them', 'save-or-discard'),
    ).toBe(
      'Save or discard your changes first, in “Images”: discarding the draft does not touch them.',
    );
  });
});

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
