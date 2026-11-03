import type { ThemeView } from '#/features/branding-editor/types/theme';
import { describe, expect, it } from 'vitest';
import {
  publishedText,
  publishHold,
  NOTHING_TO_PUBLISH,
} from '#/features/branding-editor/services/publishDraft';
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

describe('the hold for nothing to publish', () => {
  it('is the sentence the server’s refusal says too', () => {
    expect(NOTHING_TO_PUBLISH).toBe('Nothing to publish: the draft matches what people see.');
  });
});
