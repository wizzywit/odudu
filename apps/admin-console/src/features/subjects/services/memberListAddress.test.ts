import { describe, expect, it } from 'vitest';
import { membersListHref } from '#/features/subjects/services/memberListAddress';

describe('the members of a group or role', () => {
  it('links the subjects of a group or a role to the list filtered by it', () => {
    expect(membersListHref('acme', 'group', 'g 1')).toBe('/console/acme/subjects?group=g+1');
    expect(membersListHref('acme', 'role', 'r1')).toBe('/console/acme/subjects?role=r1');
  });
});
