import { expect, it } from 'vitest';
import { modeAfter, modeOfChoice } from '#/widgets/assistant-panel/services/modeSwitch';

it('takes the mode the server put in force', () => {
  expect(
    modeAfter({ ok: true, status: 200, data: { mode: 'act' }, etag: null, next: null }),
  ).toEqual({
    mode: 'act',
    problem: null,
  });
});

it('keeps the mode and says so when the server refused the switch', () => {
  expect(
    modeAfter({
      ok: false,
      kind: 'problem',
      problem: { type: 'about:blank', title: 'Conflict', status: 409 },
    }),
  ).toEqual({ mode: null, problem: 'The mode could not be changed. Try again.' });
  expect(modeAfter({ ok: false, kind: 'network' }).mode).toBeNull();
});

it('reads a switch’s value as a mode only when it is one', () => {
  expect(modeOfChoice('act')).toBe('act');
  expect(modeOfChoice('ask')).toBe('ask');
  expect(modeOfChoice('root')).toBeNull();
});
