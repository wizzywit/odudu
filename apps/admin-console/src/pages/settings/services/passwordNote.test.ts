import { describe, expect, it } from 'vitest';
import { passwordNote } from '#/pages/settings/services/passwordNote';

describe('passwordNote', () => {
  it('warns about a short minimum when a second factor is not required', () => {
    expect(passwordNote(8, false)).toEqual({
      tone: 'warning',
      text: 'A minimum under 15 is only safe when every sign-in needs a second factor. Raise it, or ask every subject for a one-time password in Sign-in flow.',
    });
  });

  it('says a short minimum is enough when every sign-in needs a second factor', () => {
    expect(passwordNote(8, true)).toEqual({
      text: 'Every sign-in needs a second factor, so this minimum is enough.',
    });
  });

  it('says nothing while the minimum is not a number', () => {
    expect(passwordNote(Number.NaN, false)).toBeNull();
  });

  it('says nothing about fifteen or more', () => {
    expect(passwordNote(15, false)).toBeNull();
    expect(passwordNote(15, true)).toBeNull();
  });
});
