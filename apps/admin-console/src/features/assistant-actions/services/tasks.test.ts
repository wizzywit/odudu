import { expect, it } from 'vitest';
import {
  ASSISTANT_TASKS,
  FREE_CHAT_PROFILE,
  isReadTask,
  taskTitleOf,
} from '#/features/assistant-actions/services/tasks';

it('names a task for its profile, and none for free chat or a profile it does not know', () => {
  expect(taskTitleOf('review-client')).toBe('Review this client');
  expect(taskTitleOf('why-cant-sign-in')).toBe('Why can’t this person sign in?');
  expect(taskTitleOf(FREE_CHAT_PROFILE)).toBeNull();
  expect(taskTitleOf('nonesuch')).toBeNull();
});

it('treats every task as one that only reads', () => {
  for (const id of Object.keys(ASSISTANT_TASKS)) expect(isReadTask(id)).toBe(true);
  expect(isReadTask(FREE_CHAT_PROFILE)).toBe(false);
});

it('puts no record’s name in the question it prepares', () => {
  for (const task of Object.values(ASSISTANT_TASKS)) expect(task.starter).not.toMatch(/[{}$]/u);
});
