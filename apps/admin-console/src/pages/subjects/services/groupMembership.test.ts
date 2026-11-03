import { describe, expect, it } from 'vitest';
import { groupPathOf, leftGroups, membershipsOf } from '#/pages/subjects/services/groupMembership';

describe('group memberships', () => {
  const known = new Map([['g1', { path: '/a', description: 'A' }]]);

  it('names each by its path and description, or by its id until it is known', () => {
    expect(membershipsOf(['g1', 'g2'], known)).toEqual([
      { id: 'g1', path: '/a', description: 'A' },
      { id: 'g2', path: 'g2', description: null },
    ]);
  });

  it('lists the paths of the groups that were held and are no longer chosen', () => {
    const held = [
      { id: 'g1', path: '/a' },
      { id: 'g2', path: '/b' },
    ];
    expect(leftGroups(held, ['g2'])).toEqual(['/a']);
    expect(leftGroups(held, ['g1', 'g2'])).toEqual([]);
  });

  it('names a group by its path once known, and by its id before', () => {
    const known = new Map([['g1', { path: '/eng' }]]);
    expect(groupPathOf(known, 'g1')).toBe('/eng');
    expect(groupPathOf(known, 'g2')).toBe('g2');
  });
});
