import { describe, expect, it } from 'vitest';
import { TITLE_MAX, titleOf } from '#/service/conversation-title';

describe('titleOf', () => {
  it('takes the first line of what was asked', () => {
    expect(titleOf('How many clients do I have?\nPlease be quick')).toBe(
      'How many clients do I have?',
    );
  });

  it('skips leading blank lines and collapses whitespace', () => {
    expect(titleOf('\n\n  list   the\tgroups ')).toBe('list the groups');
  });

  it('takes out links, addresses and long numbers', () => {
    const title = titleOf(
      'Why can ada@example.com not sign in at https://acme.example/login with 4111 1111 1111 1111',
    );
    expect(title).toBe('Why can not sign in at with');
  });

  it('takes out a secret the masker recognises', () => {
    const title = titleOf(
      'Use Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghijklmnop to call it',
    );
    expect(title).not.toContain('eyJ');
  });

  it('cuts at the limit with an ellipsis and never splits a character', () => {
    const title = titleOf('é'.repeat(200));
    expect(Array.from(title ?? '')).toHaveLength(TITLE_MAX);
    expect(title?.endsWith('…')).toBe(true);
  });

  it('is null when nothing readable is left', () => {
    expect(titleOf('   ')).toBeNull();
    expect(titleOf('https://example.com/a')).toBeNull();
    expect(titleOf('1234567890')).toBeNull();
  });
});
