import { expect, it } from 'vitest';
import {
  historyOf,
  historyWhileResuming,
  mayShowStored,
  modeOf,
  readIdOf,
  storedOf,
} from '#/widgets/assistant-panel/services/history';

it('says where the stored conversation is, and nothing for one that has not started', () => {
  expect(historyOf({ status: 'loading' }, false)).toBe('none');
  expect(historyOf({ status: 'loading' }, true)).toBe('loading');
  expect(historyOf({ status: 'ready' }, true)).toBe('ready');
  expect(historyOf({ status: 'failed' }, true)).toBe('failed');
});

it('is loading while the panel finds the conversation to reopen, and otherwise as it was', () => {
  expect(historyWhileResuming('none', true)).toBe('loading');
  expect(historyWhileResuming('none', false)).toBe('none');
  expect(historyWhileResuming('ready', true)).toBe('ready');
  expect(historyWhileResuming('failed', true)).toBe('failed');
});

it('hands over what was read only once it has been', () => {
  const ready = { status: 'ready' as const, data: { mode: 'act' as const } };
  expect(storedOf(ready, true)).toEqual({ mode: 'act' });
  expect(storedOf(ready, false)).toBeUndefined();
  expect(storedOf({ status: 'loading' }, true)).toBeUndefined();
});

it('is in the mode a stored conversation is in, and Ask for any other', () => {
  expect(modeOf({ mode: 'act' })).toBe('act');
  expect(modeOf({ mode: 'ask' })).toBe('ask');
  expect(modeOf(undefined)).toBe('ask');
});

it('shows a stored conversation only over a panel with nothing live and nothing drawn', () => {
  expect(mayShowStored('ready', 0)).toBe(true);
  expect(mayShowStored('ready', 2)).toBe(false);
  expect(mayShowStored('streaming', 0)).toBe(false);
  expect(mayShowStored('submitted', 0)).toBe(false);
});

it('does not read the conversation this panel made itself', () => {
  expect(readIdOf('c1', null)).toBe('c1');
  expect(readIdOf('c1', 'c1')).toBeNull();
  expect(readIdOf(null, null)).toBeNull();
  expect(readIdOf('c2', 'c1')).toBe('c2');
});
