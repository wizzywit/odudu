import { describe, expect, it } from 'vitest';
import { RELEASE_CAVEAT } from '@site/src/features/landing/services/release';
import {
  copyLabel,
  copyStatusOf,
  copyTimerIdle,
  noteFor,
} from '@site/src/features/landing/services/copyStatus';

describe('the copy status', () => {
  it('says whether the copy worked', () => {
    expect(copyStatusOf(true)).toBe('copied');
    expect(copyStatusOf(false)).toBe('failed');
  });

  it('words the note and the button for each state', () => {
    expect(noteFor('idle')).toContain('Docker with Compose v2');
    expect(noteFor('idle')).not.toContain(RELEASE_CAVEAT);
    expect(noteFor('copied')).toContain('clipboard');
    expect(noteFor('failed')).toContain('by hand');
    expect(copyLabel('copied')).toBe('Copied');
    expect(copyLabel('idle')).toBe('Copy');
  });

  it('has nothing to count down while idle, and counts the others down', () => {
    expect(copyTimerIdle('idle')).toBe(true);
    expect(copyTimerIdle('copied')).toBe(false);
    expect(copyTimerIdle('failed')).toBe(false);
  });
});
