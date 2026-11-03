import { expect, it } from 'vitest';
import { activityWords } from '#/features/record-activity/services/activityWords';

it('names the record in the empty heading and the table label', () => {
  const words = activityWords('scope');
  expect(words.emptyTitle).toBe('No activity on this scope yet');
  expect(words.tableLabel).toBe('Activity on this scope');
});
