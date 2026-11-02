import { expect, it } from 'vitest';
import { groupListScope } from '#/features/groups/services/list';

it('lists the top of the tree until a search is typed, then every level', () => {
  expect(groupListScope(null)).toEqual({ searching: false, fixed: { parent: 'root' } });
  expect(groupListScope('')).toEqual({ searching: false, fixed: { parent: 'root' } });
  expect(groupListScope('ops')).toEqual({ searching: true, fixed: {} });
});
