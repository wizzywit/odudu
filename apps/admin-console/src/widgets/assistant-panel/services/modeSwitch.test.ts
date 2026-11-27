import { expect, it } from 'vitest';
import {
  modeAfter,
  modeOfChoice,
  shownMode,
  TARGET_ACT_DETAIL,
} from '#/widgets/assistant-panel/services/modeSwitch';

it('takes the mode the server put in force', () => {
  expect(
    modeAfter({ ok: true, status: 200, data: { mode: 'act' }, etag: null, next: null }, null),
  ).toEqual({
    mode: 'act',
    problem: null,
  });
});

it('keeps the mode and says so when the server refused the switch', () => {
  expect(
    modeAfter(
      {
        ok: false,
        kind: 'problem',
        problem: { type: 'about:blank', title: 'Conflict', status: 409 },
      },
      null,
    ),
  ).toEqual({ mode: null, problem: 'The mode could not be changed. Try again.' });
  expect(modeAfter({ ok: false, kind: 'network' }, null).mode).toBeNull();
});

it('names the tenant that does not offer Act, and only when the server says so', () => {
  const declined = {
    ok: false,
    kind: 'problem',
    problem: { type: 'about:blank', title: 'Conflict', status: 409, detail: TARGET_ACT_DETAIL },
  } as const;
  expect(modeAfter(declined, 'demo')).toEqual({
    mode: null,
    problem: 'demo does not offer Act, so this conversation stays in Ask.',
  });
  expect(modeAfter(declined, null).problem).toBe('The mode could not be changed. Try again.');
});

it('reads a switch’s value as a mode only when it is one', () => {
  expect(modeOfChoice('act')).toBe('act');
  expect(modeOfChoice('ask')).toBe('ask');
  expect(modeOfChoice('root')).toBeNull();
});

it('shows the mode the person chose, else the conversation’s own', () => {
  expect(shownMode(null, 'ask')).toBe('ask');
  expect(shownMode('act', 'ask')).toBe('act');
  expect(shownMode(null, 'act')).toBe('act');
});
