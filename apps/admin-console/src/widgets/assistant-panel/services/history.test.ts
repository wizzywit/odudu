import { expect, it } from 'vitest';
import { historyOf, modeOf, storedOf } from '#/widgets/assistant-panel/services/history';

it('says where the stored conversation is, and nothing for one that has not started', () => {
  expect(historyOf({ status: 'loading' }, false)).toBe('none');
  expect(historyOf({ status: 'loading' }, true)).toBe('loading');
  expect(historyOf({ status: 'ready' }, true)).toBe('ready');
  expect(historyOf({ status: 'failed' }, true)).toBe('failed');
});

it('hands over what was read only once it has been', () => {
  const ready = { status: 'ready' as const, data: { mode: 'act' as const } };
  expect(storedOf(ready, true)).toEqual({ mode: 'act' });
  expect(storedOf(ready, false)).toBeUndefined();
  expect(storedOf({ status: 'loading' }, true)).toBeUndefined();
});

it('takes the person’s mode over the conversation’s, and that over the tenant’s', () => {
  expect(modeOf('act', { mode: 'ask' }, 'ask')).toBe('act');
  expect(modeOf(null, { mode: 'act' }, 'ask')).toBe('act');
  expect(modeOf(null, undefined, 'act')).toBe('act');
  expect(modeOf(null, undefined, undefined)).toBe('ask');
});
