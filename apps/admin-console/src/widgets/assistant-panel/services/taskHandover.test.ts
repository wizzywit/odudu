import { expect, it } from 'vitest';
import { handoverNote, startingDraft } from '#/widgets/assistant-panel/services/taskHandover';

const TASK = { tenant: 'acme', profile: 'review-client', draft: 'Review.', seq: 1 };
const carry = (draft: string, stopped: boolean) => ({ tenant: 'acme', draft, stopped });

it('puts the task’s question in an empty field and keeps a message already begun', () => {
  expect(startingDraft(TASK, null)).toBe('Review.');
  expect(startingDraft(TASK, carry('', false))).toBe('Review.');
  expect(startingDraft(TASK, carry('   ', false))).toBe('Review.');
  expect(startingDraft(TASK, carry('Why is', false))).toBe('Why is');
  expect(startingDraft(null, carry('Why is', false))).toBe('');
});

it('says what became of a stopped answer and of a kept message, and nothing otherwise', () => {
  expect(handoverNote(TASK, null)).toBeNull();
  expect(handoverNote(null, carry('x', true))).toBeNull();
  expect(handoverNote(TASK, carry('', false))).toBeNull();
  expect(handoverNote(TASK, carry('', true))).toContain('stopped');
  expect(handoverNote(TASK, carry('x', false))).toContain('kept');
  expect(handoverNote(TASK, carry('x', true))).toMatch(/stopped.*kept/u);
});
