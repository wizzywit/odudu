import { describe, expect, it } from 'vitest';
import { membersListHref } from '#/pages/subjects/services/memberListAddress';

const LIST = '/console/acme/subjects';

describe('the members of a group or role', () => {
  it('links the subjects of a group or a role to the list filtered by it', () => {
    expect(membersListHref(LIST, 'group', 'g 1')).toBe('/console/acme/subjects?group=g+1');
    expect(membersListHref(LIST, 'role', 'r1')).toBe('/console/acme/subjects?role=r1');
  });
});
