import { expect, it } from 'vitest';
import { lastChosen } from '#/shared/service/picker.ts';

it('keeps the last of the ids a picker reports, or none', () => {
  expect(lastChosen(['a', 'b'])).toBe('b');
  expect(lastChosen(['a'])).toBe('a');
  expect(lastChosen([])).toBeNull();
});
