import { expect, it } from 'vitest';
import {
  activityLine,
  durationText,
  hasPhrase,
  phrasedTools,
} from '#/widgets/assistant-panel/services/activity-lines';

it('words a read from its name and a special tool from the table', () => {
  expect(activityLine({ name: 'list_subjects', state: 'running' }).text).toBe('Listing subjects');
  expect(activityLine({ name: 'get_client', state: 'done' }).text).toBe('Read client');
  expect(activityLine({ name: 'get_subject_lockout', state: 'running' }).text).toBe(
    'Checking lockout state',
  );
  expect(hasPhrase('get_subject_lockout')).toBe(true);
});

it('says what became of a step, and keeps the time it took', () => {
  expect(activityLine({ name: 'list_roles', state: 'failed' }).text).toBe('Listing roles failed');
  expect(activityLine({ name: 'create_group', state: 'waiting' }).text).toBe(
    'Proposing a new group, waiting for you',
  );
  expect(activityLine({ name: 'create_group', state: 'denied' }).text).toBe(
    'Proposing a new group, refused',
  );
  expect(activityLine({ name: 'list_roles', state: 'done', durationMs: 1_800 })).toEqual({
    text: 'Listed roles',
    state: 'done',
    durationMs: 1_800,
  });
});

it('falls back to a generic phrase for a tool nobody has worded', () => {
  expect(activityLine({ name: 'frobnicate_widget', state: 'running' }).text).toBe(
    'Running frobnicate widget',
  );
  expect(activityLine({ name: 'frobnicate_widget', state: 'done' }).text).toBe('Frobnicate widget');
  expect(hasPhrase('frobnicate_widget')).toBe(false);
  expect(phrasedTools().length).toBeGreaterThan(10);
});

it.each([
  [400, 'under 1 s'],
  [1_800, '1.8 s'],
  [12_400, '12 s'],
])('writes %d ms as %s', (ms, text) => {
  expect(durationText(ms)).toBe(text);
});
