import { expect, it } from 'vitest';
import { AUTO, choiceOf, sentOf } from '#/features/clients/service/choices.ts';

it('holds an unset choice as one the select can name, and sends it as null', () => {
  expect(choiceOf(null)).toBe(AUTO);
  expect(choiceOf('RS256')).toBe('RS256');
  expect(sentOf(AUTO)).toBeNull();
  expect(sentOf('ES256')).toBe('ES256');
});
