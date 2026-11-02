import { expect, it } from 'vitest';
import { firstChosen, lastChosen } from '#/shared/services/picker';

it('keeps the last of the ids a picker reports, or none', () => {
  expect(lastChosen(['a', 'b'])).toBe('b');
  expect(lastChosen(['a'])).toBe('a');
  expect(lastChosen([])).toBeNull();
});

it('keeps the first of the ids a picker reports, or none', () => {
  expect(firstChosen(['a', 'b'])).toBe('a');
  expect(firstChosen([])).toBeNull();
});
