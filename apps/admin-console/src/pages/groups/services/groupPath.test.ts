import { expect, it } from 'vitest';
import { NAME_FIXED } from '#/pages/groups/services/groupPath';

it('says a group name is fixed because the groups claim carries its path', () => {
  expect(NAME_FIXED).toBe(
    "A group's name is fixed once it is made: the groups claim carries its path, and a relying party that matches on it would otherwise pass or fail by a token's age.",
  );
});
