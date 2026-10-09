import { expect, it } from 'vitest';
import { describeValue } from '#/shared/service/conflict.ts';

it('reads a value the way a person would type it', () => {
  expect(describeValue('Billing portal')).toBe('Billing portal');
  expect(describeValue(300)).toBe('300');
  expect(describeValue(true)).toBe('on');
  expect(describeValue(false)).toBe('off');
  expect(describeValue(['https://a.example/cb', 'https://b.example/cb'])).toBe(
    'https://a.example/cb, https://b.example/cb',
  );
  expect(describeValue({ tier: 'gold' })).toBe('{"tier":"gold"}');
});

it('never shows a blank for a value that is not there', () => {
  expect(describeValue(null)).toBe('not set');
  expect(describeValue(undefined)).toBe('not set');
  expect(describeValue('')).toBe('empty');
  expect(describeValue([])).toBe('none');
});
