import { MESSAGE_TEXT_MAX } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import { canSend, keyAction, messageToSend } from '#/widgets/assistant-panel/services/composer';

const KEY = { key: 'Enter', shiftKey: false, isComposing: false };

describe('the composer’s keys', () => {
  it('sends on Enter, and starts a new line on Shift and Enter', () => {
    expect(keyAction(KEY)).toBe('send');
    expect(keyAction({ ...KEY, shiftKey: true })).toBe('newline');
  });

  it('leaves every other key, and an Enter that confirms a composition, to the field', () => {
    expect(keyAction({ ...KEY, key: 'a' })).toBe('type');
    expect(keyAction({ ...KEY, isComposing: true })).toBe('type');
  });
});

describe('what may be sent', () => {
  it('needs some text and no answer in progress', () => {
    expect(canSend('hello', false)).toBe(true);
    expect(canSend('   \n ', false)).toBe(false);
    expect(canSend('', false)).toBe(false);
    expect(canSend('hello', true)).toBe(false);
  });

  it('holds a message to the most the server takes', () => {
    expect(canSend('a'.repeat(MESSAGE_TEXT_MAX), false)).toBe(true);
    expect(canSend('a'.repeat(MESSAGE_TEXT_MAX + 1), false)).toBe(false);
  });

  it('sends the text as typed, trimmed at the ends only', () => {
    expect(messageToSend('  hello\n\nworld \n')).toBe('hello\n\nworld');
  });
});
