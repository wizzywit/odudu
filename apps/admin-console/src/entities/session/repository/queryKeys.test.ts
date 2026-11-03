import { expect, it } from 'vitest';
import { sessionKey } from '#/entities/session/repository/queryKeys';

it('names the one session read', () => {
  expect(sessionKey()).toEqual(['session']);
});
