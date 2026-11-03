import { describe, expect, it } from 'vitest';
import {
  DISCARD_BODY_TENANT,
  discardBody,
  discardFailure,
  discardUnsaved,
} from '#/features/branding-editor/services/discardDraft';

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

describe('the sentence that asks for a save or a discard first', () => {
  it('names the sections and what is left alone', () => {
    expect(discardUnsaved(['Colours and font'])).toBe(
      'Save or discard your changes first, in “Colours and font”: discarding the draft does not touch them.',
    );
    expect(discardUnsaved(['Images', 'Stylesheet'])).toBe(
      'Save or discard your changes first, in “Images” and “Stylesheet”: discarding the draft does not touch them.',
    );
  });
});
