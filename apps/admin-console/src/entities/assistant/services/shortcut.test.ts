import { expect, it } from 'vitest';
import { opensAssistant, type ShortcutEvent } from '#/entities/assistant/services/shortcut';

function press(over: Partial<ShortcutEvent>): ShortcutEvent {
  return {
    key: 'k',
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
  expect(opensAssistant(press({ metaKey: true }), 'mac')).toBe(true);
  expect(opensAssistant(press({ ctrlKey: true }), 'mac')).toBe(false);
  expect(opensAssistant(press({ ctrlKey: true }), 'other')).toBe(true);
  expect(opensAssistant(press({ metaKey: true }), 'other')).toBe(false);
  expect(opensAssistant(press({ key: 'K', ctrlKey: true }), 'other')).toBe(true);
});

it('leaves a chord with another modifier, a composing key and a handled key alone', () => {
  expect(opensAssistant(press({ ctrlKey: true, shiftKey: true }), 'other')).toBe(false);
  expect(opensAssistant(press({ ctrlKey: true, altKey: true }), 'other')).toBe(false);
  expect(opensAssistant(press({ ctrlKey: true, isComposing: true }), 'other')).toBe(false);
  expect(opensAssistant(press({ ctrlKey: true, defaultPrevented: true }), 'other')).toBe(false);
  expect(opensAssistant(press({ ctrlKey: true, key: 'j' }), 'other')).toBe(false);
});

it('does nothing while a text field in a dialog has the focus, but works in a page field', () => {
  const dialog = document.createElement('div');
  dialog.setAttribute('role', 'dialog');
  const inside = document.createElement('input');
  dialog.append(inside);
  const button = document.createElement('button');
  dialog.append(button);
  const outside = document.createElement('textarea');
  document.body.append(dialog, outside);
  expect(opensAssistant(press({ ctrlKey: true, target: inside }), 'other')).toBe(false);
  expect(opensAssistant(press({ ctrlKey: true, target: button }), 'other')).toBe(true);
  expect(opensAssistant(press({ ctrlKey: true, target: outside }), 'other')).toBe(true);
  dialog.remove();
  outside.remove();
});
