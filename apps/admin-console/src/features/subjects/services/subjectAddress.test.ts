import { describe, expect, it } from 'vitest';
import {
  newSubjectHref,
  subjectHref,
  subjectsHref,
  subjectsTrail,
  subjectTabHref,
} from '#/features/subjects/services/subjectAddress';

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

describe('the tabs of a record', () => {
  it('addresses one tab of a record', () => {
    expect(subjectTabHref('acme', 's 1', 'roles')).toBe('/console/acme/subjects/s%201?tab=roles');
  });
});
