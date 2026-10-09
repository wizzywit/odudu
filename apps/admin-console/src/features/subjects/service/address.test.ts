import { describe, expect, it } from 'vitest';
import {
  createSubjectHref,
  membersListHref,
  newSubjectHref,
  subjectHref,
  subjectName,
  subjectsHref,
  subjectsTrail,
} from '#/features/subjects/service/address.ts';

describe('addresses', () => {
  it('puts a subject under its tenant, each part escaped', () => {
    expect(subjectsHref('acme')).toBe('/console/acme/subjects');
    expect(newSubjectHref('acme')).toBe('/console/acme/subjects/new');
    expect(subjectHref('acme', 'a b')).toBe('/console/acme/subjects/a%20b');
  });
});

describe('the way back to the list', () => {
  it('climbs through the Identity group to the tenant’s subjects', () => {
    expect(subjectsTrail('a b', 'grace')).toEqual([
      { label: 'Identity' },
      { label: 'Subjects', href: '/console/a%20b/subjects' },
      { label: 'grace' },
    ]);
  });
});

describe('the username', () => {
  it('names a subject by its username, or by its kind and id when it has none', () => {
    expect(subjectName({ id: 's1', type: 'user', username: 'ada' })).toBe('ada');
    expect(subjectName({ id: 's2', type: 'service', username: null })).toBe('service s2');
  });
});

describe('creating a subject', () => {
  it('offers creating only while nothing rules it out', () => {
    expect(createSubjectHref('acme', [])).toBe('/console/acme/subjects/new');
    expect(createSubjectHref('acme', ['manage-users'])).toBeNull();
  });

  it('links the subjects of a group or a role to the list filtered by it', () => {
    expect(membersListHref('acme', 'group', 'g 1')).toBe('/console/acme/subjects?group=g+1');
    expect(membersListHref('acme', 'role', 'r1')).toBe('/console/acme/subjects?role=r1');
  });
});
