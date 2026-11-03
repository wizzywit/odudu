import { expect, it } from 'vitest';
import { publishedLane } from '#/entities/signing-key/services/keyLane';

it('names a published key by the status the list gives it', () => {
  expect(publishedLane('active', true)).toBe('active');
  expect(publishedLane('rotating', true)).toBe('rotating');
  expect(publishedLane('retired', true)).toBe('retired');
});

it('calls a published key the list does not hold unlisted', () => {
  expect(publishedLane(undefined, true)).toBe('unlisted');
});

it('calls every published key unknown while the list could not be read', () => {
  expect(publishedLane(undefined, false)).toBe('unknown');
  expect(publishedLane('active', false)).toBe('unknown');
});
