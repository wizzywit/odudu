import { ACCESS_TOKEN_CEILING_SECONDS } from '@odudu/contracts/admin';
import { expect, it } from 'vitest';
import { transitionNote, windowWords } from '#/pages/domains/services/transition';

it('reads the window from the access token ceiling the token endpoint enforces', () => {
  expect(transitionNote()).toContain(windowWords(ACCESS_TOKEN_CEILING_SECONDS));
});

it('says a whole number of hours, then minutes, then seconds', () => {
  expect(windowWords(3600)).toBe('1 hour');
  expect(windowWords(7200)).toBe('2 hours');
  expect(windowWords(900)).toBe('15 minutes');
  expect(windowWords(45)).toBe('45 seconds');
});

it('names what the previous address keeps serving and what it refuses', () => {
  const note = transitionNote();
  expect(note).toContain('token');
  expect(note).toContain('userinfo');
  expect(note).toContain('sign-in');
});
