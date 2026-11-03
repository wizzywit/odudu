import { describe, expect, it } from 'vitest';
import { RELEASE_CAVEAT } from '@site/src/features/landing/services/content';
import { copyLabel, copyStatusOf, noteFor } from '@site/src/features/landing/services/copyStatus';

describe('the copy status', () => {
  it('says whether the copy worked', () => {
    expect(copyStatusOf(true)).toBe('copied');
    expect(copyStatusOf(false)).toBe('failed');
  });

  it('words the note and the button for each state', () => {
    expect(noteFor('idle')).toContain(RELEASE_CAVEAT);
    expect(noteFor('copied')).toContain('clipboard');
    expect(noteFor('failed')).toContain('by hand');
    expect(copyLabel('copied')).toBe('Copied');
    expect(copyLabel('idle')).toBe('Copy');
  });
});
