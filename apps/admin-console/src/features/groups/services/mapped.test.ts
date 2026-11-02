import { describe, expect, it } from 'vitest';
import { keptRoles, reachOfRoles } from '#/features/groups/services/mapped';
import { reach } from '#/testing/roleAnswers';

describe('the roles of a group', () => {
  const items = [
    {
      id: 'r1',
      name: 'auditor',
      client_id: 'c',
      client_key: 'k',
      description: null,
      admin_reach: reach('view-audit'),
    },
    {
      id: 'r2',
      name: 'plain',
      client_id: null,
      client_key: null,
      description: null,
      admin_reach: reach(),
    },
  ];
  it('keeps the mapped roles the caller could not give', () => {
    expect(keptRoles(items, reach('manage-users'), 'acme')).toEqual(['r1']);
    expect(keptRoles(items, reach('view-audit'), 'acme')).toEqual([]);
  });

  it('adds up what the removed roles hand out', () => {
    expect(reachOfRoles(items, ['r1', 'r2', 'gone'])).toEqual(['view-audit']);
  });
});
