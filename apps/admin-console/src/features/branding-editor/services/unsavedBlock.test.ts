import { describe, expect, it } from 'vitest';
import { unsavedBlock } from '#/features/branding-editor/services/unsavedBlock';

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
