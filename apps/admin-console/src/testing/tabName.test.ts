import { expect, it } from 'vitest';
import { tabName } from '#/testing/tabName';

it('matches a name with or without the space before a suffix, and nothing longer', () => {
  const name = tabName('B', 'unsaved changes', 'changes to publish');
  expect(name.test('B, unsaved changes, changes to publish')).toBe(true);
  expect(name.test('B , unsaved changes , changes to publish')).toBe(true);
  expect(name.test('B, unsaved changes')).toBe(false);
  expect(name.test('AB, unsaved changes, changes to publish')).toBe(false);
});
