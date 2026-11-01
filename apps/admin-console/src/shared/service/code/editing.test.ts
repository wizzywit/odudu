import { describe, expect, it } from 'vitest';
import {
  changesNothing,
  historyKey,
  indentEdit,
  insertEdit,
  keyStep,
  type KeyPress,
  type TextEdit,
} from '#/shared/service/code';

function applyEdit(value: string, edit: TextEdit): string {
  return value.slice(0, edit.from) + edit.text + value.slice(edit.to);
}

const press = (key: string, more: Partial<KeyPress> = {}): KeyPress => ({
  key,
  code: '',
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  composing: false,
  ...more,
});

describe('keyStep', () => {
  it('indents on Tab and outdents on Shift+Tab', () => {
    expect(keyStep(press('Tab'), false)).toEqual({ action: 'indent', escaped: false });
    expect(keyStep(press('Tab', { shiftKey: true }), false)).toEqual({
      action: 'outdent',
      escaped: false,
    });
  });

  it('lets the next Tab leave after Escape, and only that one', () => {
    const escaped = keyStep(press('Escape'), false);
    expect(escaped).toEqual({ action: 'none', escaped: true });
    expect(keyStep(press('Tab'), escaped.escaped)).toEqual({ action: 'none', escaped: false });
    expect(keyStep(press('Tab'), false).action).toBe('indent');
  });

  it('keeps the escape while a modifier is pressed for Shift+Tab', () => {
    expect(keyStep(press('Shift', { shiftKey: true }), true).escaped).toBe(true);
    expect(keyStep(press('Tab', { shiftKey: true }), true)).toEqual({
      action: 'none',
      escaped: false,
    });
  });

  it('forgets the escape on any other key', () => {
    expect(keyStep(press('a'), true)).toEqual({ action: 'none', escaped: false });
  });

  it('leaves every key to an input method that is composing, and keeps the escape as it was', () => {
    for (const key of ['Tab', 'Escape', 'a']) {
      expect(keyStep(press(key, { composing: true }), false)).toEqual({
        action: 'none',
        escaped: false,
      });
      expect(keyStep(press(key, { composing: true }), true)).toEqual({
        action: 'none',
        escaped: true,
      });
    }
  });

  it('leaves Ctrl, Cmd and Alt with Tab to the browser', () => {
    for (const more of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      expect(keyStep(press('Tab', more), false).action).toBe('none');
    }
  });
});

function indented(value: string, start: number, end: number, outdent = false) {
  const edit = indentEdit(value, start, end, outdent);
  return edit === null
    ? null
    : { value: applyEdit(value, edit), selection: [edit.selectionStart, edit.selectionEnd] };
}

describe('indentEdit', () => {
  it('inserts an indent at the caret', () => {
    expect(indented('a: b', 2, 2)).toEqual({ value: 'a:   b', selection: [4, 4] });
  });

  it('replaces a selection within one line by an indent', () => {
    expect(indented('abcdef', 1, 4)).toEqual({ value: 'a  ef', selection: [3, 3] });
  });

  it('indents every touched line and keeps the selection over them', () => {
    expect(indented('a\nb\nc', 0, 5)).toEqual({ value: '  a\n  b\n  c', selection: [0, 11] });
    expect(indented('a\nb\nc', 2, 4)).toEqual({ value: 'a\n  b\nc', selection: [2, 6] });
  });

  it('skips empty lines and a line the selection only reaches the start of', () => {
    expect(indented('a\n\nb\nc', 0, 5)).toEqual({ value: '  a\n\n  b\nc', selection: [0, 9] });
    expect(indented('a\nb\nc', 0, 4)).toEqual({ value: '  a\n  b\nc', selection: [0, 8] });
  });

  it('moves a selection that starts inside a line along with its text', () => {
    expect(indented('ab\ncd', 1, 4)).toEqual({ value: '  ab\n  cd', selection: [3, 8] });
  });
});

describe('indentEdit outdenting', () => {
  it('takes two spaces, one, or a tab from the line of the caret', () => {
    expect(indented('    a', 5, 5, true)).toEqual({ value: '  a', selection: [3, 3] });
    expect(indented(' a', 2, 2, true)).toEqual({ value: 'a', selection: [1, 1] });
    expect(indented('\ta', 2, 2, true)).toEqual({ value: 'a', selection: [1, 1] });
  });

  it('clamps a caret inside the part removed', () => {
    expect(indented('  a', 1, 1, true)).toEqual({ value: 'a', selection: [0, 0] });
  });

  it('outdents each touched line', () => {
    expect(indented('  a\n    b\nc', 0, 11, true)).toEqual({
      value: 'a\n  b\nc',
      selection: [0, 7],
    });
  });

  it('is nothing when nothing leads the lines', () => {
    expect(indentEdit('a\nb', 0, 3, true)).toBeNull();
  });
});

describe('historyKey', () => {
  it('is undo on Ctrl or Cmd+Z, redo on Shift+Z and on Ctrl+Y where that is redo', () => {
    expect(historyKey(press('z', { ctrlKey: true }), 'other')).toBe('undo');
    expect(historyKey(press('Z', { metaKey: true }), 'mac')).toBe('undo');
    expect(historyKey(press('Z', { metaKey: true, shiftKey: true }), 'mac')).toBe('redo');
    expect(historyKey(press('z', { ctrlKey: true, shiftKey: true }), 'other')).toBe('redo');
    expect(historyKey(press('y', { ctrlKey: true }), 'other')).toBe('redo');
  });

  it('leaves Ctrl+Y to an Apple keyboard, and Cmd+Y to everyone', () => {
    expect(historyKey(press('y', { ctrlKey: true }), 'mac')).toBeNull();
    expect(historyKey(press('y', { metaKey: true }), 'other')).toBeNull();
  });

  it('is nothing for a bare letter, Alt, or while composing', () => {
    expect(historyKey(press('z'), 'other')).toBeNull();
    expect(historyKey(press('z', { ctrlKey: true, altKey: true }), 'other')).toBeNull();
    expect(historyKey(press('z', { ctrlKey: true, composing: true }), 'other')).toBeNull();
  });

  it('follows the key on a layout that is not Latin', () => {
    expect(historyKey(press('я', { ctrlKey: true, code: 'KeyZ' }), 'other')).toBe('undo');
    expect(historyKey(press('Я', { ctrlKey: true, shiftKey: true, code: 'KeyZ' }), 'other')).toBe(
      'redo',
    );
    expect(historyKey(press('н', { ctrlKey: true, code: 'KeyY' }), 'other')).toBe('redo');
    expect(historyKey(press('ж', { ctrlKey: true, code: 'Semicolon' }), 'other')).toBeNull();
  });
});

describe('changesNothing', () => {
  it('is an empty replacement of nothing', () => {
    const edit = { from: 2, to: 2, text: '', selectionStart: 2, selectionEnd: 2 };
    expect(changesNothing(edit)).toBe(true);
    expect(changesNothing({ ...edit, to: 3 })).toBe(false);
    expect(changesNothing({ ...edit, text: ' ' })).toBe(false);
  });
});

describe('insertEdit', () => {
  it('puts the text at the caret and leaves the caret after it', () => {
    const edit = insertEdit('<h1></h1>', 4, 4, '{{t "a"}}');
    expect(applyEdit('<h1></h1>', edit)).toBe('<h1>{{t "a"}}</h1>');
    expect(edit.selectionStart).toBe(4 + '{{t "a"}}'.length);
    expect(edit.selectionEnd).toBe(edit.selectionStart);
  });

  it('replaces a selection', () => {
    const edit = insertEdit('one two three', 4, 7, 'X');
    expect(applyEdit('one two three', edit)).toBe('one X three');
    expect(edit.selectionStart).toBe(5);
  });

  it('works on an empty text and takes a backwards selection as given', () => {
    expect(applyEdit('', insertEdit('', 0, 0, 'abc'))).toBe('abc');
    expect(applyEdit('abcdef', insertEdit('abcdef', 4, 2, '-'))).toBe('ab-ef');
  });

  it('is an edit, not nothing, for a non-empty insertion', () => {
    expect(changesNothing(insertEdit('x', 0, 0, 'y'))).toBe(false);
  });
});
