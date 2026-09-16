import { describe, expect, it } from 'vitest';
import { MAX_PASSWORD_LENGTH, PASSWORD_TOO_LONG, readPasswordField } from '#/password-field';

describe('readPasswordField', () => {
  it('reads a single value through', () => {
    expect(readPasswordField('correct horse')).toEqual({
      kind: 'present',
      password: 'correct horse',
    });
  });

  it('treats an absent field as absent', () => {
    expect(readPasswordField(undefined)).toEqual({ kind: 'absent' });
  });

  // A repeated field is ambiguous, and picking one of the two would let a
  // submission carry a password the form never showed.
  it('treats a repeated field as absent rather than picking one', () => {
    expect(readPasswordField(['a', 'b'])).toEqual({ kind: 'absent' });
  });

  it('reads an empty value through as present, leaving emptiness to the caller', () => {
    expect(readPasswordField('')).toEqual({ kind: 'present', password: '' });
  });

  it('accepts a candidate of exactly the maximum length', () => {
    const password = 'a'.repeat(MAX_PASSWORD_LENGTH);
    expect(readPasswordField(password)).toEqual({ kind: 'present', password });
  });

  it('refuses one character more', () => {
    expect(readPasswordField('a'.repeat(MAX_PASSWORD_LENGTH + 1))).toEqual({ kind: 'too_long' });
  });

  // Truncating would make two different passwords authenticate one account.
  it('refuses rather than truncating', () => {
    const result = readPasswordField('a'.repeat(MAX_PASSWORD_LENGTH + 1));
    expect(result.kind === 'present' ? result.password : null).toBeNull();
  });

  // Counted the way password_min_length is counted in evaluatePassword:
  // '🔑'.length is 2, so a UTF-16 count would refuse a password 128
  // graphemes short of the limit.
  it('counts code points, not UTF-16 code units', () => {
    const password = '🔑'.repeat(MAX_PASSWORD_LENGTH);
    expect(password.length).toBeGreaterThan(MAX_PASSWORD_LENGTH);
    expect(readPasswordField(password)).toEqual({ kind: 'present', password });
  });

  // One message for all four readers, so the limit a user is told about
  // cannot drift from the limit that refused them.
  it('names the limit in the message a refusal is reported with', () => {
    expect(PASSWORD_TOO_LONG.message).toContain(String(MAX_PASSWORD_LENGTH));
  });
});
