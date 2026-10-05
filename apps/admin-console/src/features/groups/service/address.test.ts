import { describe, expect, it } from 'vitest';
import {
  groupHref,
  groupsHref,
  groupsTrail,
  newGroupHref,
} from '#/features/groups/service/address.ts';

describe('addresses', () => {
  it('puts a group under its tenant, and a new one under the parent it was asked from', () => {
    expect(groupsHref('acme')).toBe('/console/acme/groups');
    expect(groupHref('acme', 'g 1')).toBe('/console/acme/groups/g%201');
    expect(newGroupHref('acme')).toBe('/console/acme/groups/new');
    expect(newGroupHref('acme', 'g-eng')).toBe('/console/acme/groups/new?parent=g-eng');
    expect(groupsTrail('acme', '/eng')).toEqual([
      { label: 'Identity' },
      { label: 'Groups', href: '/console/acme/groups' },
      { label: '/eng' },
    ]);
  });
});
