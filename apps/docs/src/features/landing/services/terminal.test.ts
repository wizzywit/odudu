import { describe, expect, it } from 'vitest';
import { COMMANDS, RELEASE_CAVEAT } from '@site/src/features/landing/services/content';
import {
  commandOf,
  copyLabel,
  copyStatusOf,
  lineVisible,
  TYPED_COMMAND,
  followUpLines,
  noteFor,
  panelTyping,
  pieces,
  shellChoices,
  overlayShown,
  segments,
  typedSegments,
  typingAfterChoice,
} from '@site/src/features/landing/services/terminal';

const COMMAND = COMMANDS[0]?.command ?? '';

describe('the hero terminal', () => {
  it('breaks a command after each slash and loses nothing', () => {
    expect(segments('curl https://a.b/c/d').join('')).toBe('curl https://a.b/c/d');
    expect(segments('x/y/z')).toEqual(['x/', 'y/', 'z']);
  });

  it('shows the first characters and keeps the rest in the same pieces', () => {
    const typed = typedSegments(COMMAND, 20);
    expect(typed.map((part) => part.shown + part.hidden).join('')).toBe(COMMAND);
    expect(typed.map((part) => part.shown).join('')).toBe(COMMAND.slice(0, 20));
    expect(typedSegments(COMMAND, 0).every((part) => part.shown === '')).toBe(true);
    expect(typedSegments(COMMAND, COMMAND.length).every((part) => part.hidden === '')).toBe(true);
  });

  it('shows a follow-up line when it is typed, or whenever typing is not under way', () => {
    expect(lineVisible('unix', 'on', 1, 0)).toBe(true);
    expect(lineVisible('unix', 'on', 1, 1)).toBe(false);
    expect(lineVisible('unix', 'done', 0, 2)).toBe(true);
    expect(lineVisible('unix', 'skip', 0, 2)).toBe(true);
    expect(lineVisible('windows', 'on', 0, 2)).toBe(true);
  });

  it('overlays only the first shell, only while it types', () => {
    expect(overlayShown('unix', 'unix', 'on')).toBe(true);
    expect(overlayShown('unix', 'windows', 'on')).toBe(false);
    expect(overlayShown('windows', 'windows', 'on')).toBe(false);
    expect(overlayShown('unix', 'unix', 'after')).toBe(false);
    expect(typingAfterChoice('on')).toBe('after');
    expect(typingAfterChoice('done')).toBe('done');
  });

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
    expect(commandOf('unix')).toBe(COMMAND);
    expect(commandOf('windows')).toContain('curl.exe');
  });
});

describe('the terminal model', () => {
  it('types the first shell command, taken from the one table', () => {
    expect(TYPED_COMMAND).toBe(COMMAND);
    expect(TYPED_COMMAND).toBe(commandOf('unix'));
  });

  it('marks a break before every piece but the first', () => {
    const list = pieces('a/b/c');
    expect(list.map((piece) => piece.breakBefore)).toEqual([false, true, true]);
    expect(list.map((piece) => piece.text).join('')).toBe('a/b/c');
  });

  it('says which typed pieces still hold hidden text', () => {
    const typed = typedSegments('ab/cd', 3);
    expect(typed.map((part) => part.hasHidden)).toEqual([false, true]);
    expect(typed.map((part) => part.breakBefore)).toEqual([false, true]);
  });

  it('lists the follow-up command first, then its output', () => {
    const lines = followUpLines();
    expect(lines[0]?.kind).toBe('command');
    expect(lines.slice(1).every((line) => line.kind === 'output')).toBe(true);
  });

  it('gives only the first shell the typing state', () => {
    expect(panelTyping('unix', 'on')).toBe('on');
    expect(panelTyping('windows', 'on')).toBe('off');
  });

  it('lists every shell with its command and checks only the chosen one', () => {
    const choices = shellChoices('windows');
    expect(choices.map((choice) => choice.shell)).toEqual(COMMANDS.map((entry) => entry.shell));
    expect(choices.filter((choice) => choice.checked).map((choice) => choice.shell)).toEqual([
      'windows',
    ]);
    expect(choices.map((choice) => choice.command)).toEqual(COMMANDS.map((entry) => entry.command));
  });
});
