import { expect, it } from 'vitest';
import {
  opensAssistant,
  shortcutOutcome,
  type ShortcutEvent,
} from '#/entities/assistant/services/shortcut';

function press(over: Partial<ShortcutEvent>): ShortcutEvent {
  return {
    key: 'k',
    code: 'KeyK',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    defaultPrevented: false,
    isComposing: false,
    target: document.body,
    ...over,
  };
}

it('answers Command K on a Mac and Control K elsewhere, and neither the other way round', () => {
  expect(opensAssistant(press({ metaKey: true }), 'mac', false)).toBe(true);
  expect(opensAssistant(press({ ctrlKey: true }), 'mac', false)).toBe(false);
  expect(opensAssistant(press({ ctrlKey: true }), 'other', false)).toBe(true);
  expect(opensAssistant(press({ metaKey: true }), 'other', false)).toBe(false);
  expect(opensAssistant(press({ key: 'K', ctrlKey: true }), 'other', false)).toBe(true);
});

it('finds the K key by its place on a layout where it types another letter', () => {
  expect(opensAssistant(press({ key: 'л', code: 'KeyK', ctrlKey: true }), 'other', false)).toBe(
    true,
  );
  expect(opensAssistant(press({ key: 'л', code: 'KeyL', ctrlKey: true }), 'other', false)).toBe(
    false,
  );
});

it('leaves a chord with another modifier, a composing key and a handled key alone', () => {
  const ctrl = { ctrlKey: true };
  expect(opensAssistant(press({ ...ctrl, shiftKey: true }), 'other', false)).toBe(false);
  expect(opensAssistant(press({ ...ctrl, altKey: true }), 'other', false)).toBe(false);
  expect(opensAssistant(press({ ...ctrl, isComposing: true }), 'other', false)).toBe(false);
  expect(opensAssistant(press({ ...ctrl, defaultPrevented: true }), 'other', false)).toBe(false);
  expect(opensAssistant(press({ ...ctrl, key: 'j', code: 'KeyJ' }), 'other', false)).toBe(false);
});

it('does nothing behind a modal: while one is open, and from anything inside a dialog', () => {
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  const field = document.createElement('input');
  const button = document.createElement('button');
  dialog.append(field, button);
  const outside = document.createElement('textarea');
  document.body.append(dialog, outside);
  const ctrl = { ctrlKey: true };
  expect(opensAssistant(press({ ...ctrl, target: field }), 'other', false)).toBe(false);
  expect(opensAssistant(press({ ...ctrl, target: button }), 'other', false)).toBe(false);
  expect(opensAssistant(press({ ...ctrl, target: outside }), 'other', false)).toBe(true);
  expect(opensAssistant(press({ ...ctrl, target: outside }), 'other', true)).toBe(false);
  dialog.remove();
  outside.remove();
});

it('opens a closed panel, moves to an open one, and ignores what is not the chord', () => {
  const chord = press({ ctrlKey: true });
  expect(shortcutOutcome(chord, 'other', { paused: false, open: false })).toBe('open');
  expect(shortcutOutcome(chord, 'other', { paused: false, open: true })).toBe('focus');
  expect(shortcutOutcome(chord, 'other', { paused: true, open: false })).toBe('ignore');
  expect(shortcutOutcome(press({}), 'other', { paused: false, open: false })).toBe('ignore');
});
