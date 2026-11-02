import type { Role } from '@odudu/contracts/admin';
import { expect, it } from 'vitest';
import { keptRoles } from '#/features/scopes/services';
import { roleIndex } from '#/shared/services/mappedRoles';

const READER = {
  id: 'r1',
  name: 'reader',
  client_id: null,
  client_key: null,
  admin_reach: [] as Role['admin_reach'],
};
const KEYS = {
  id: 'r2',
  name: 'keeper',
  client_id: null,
  client_key: null,
  admin_reach: ['manage-keys'] as Role['admin_reach'],
};

it('keeps a mapped role the caller could not give, though the picker has not loaded it', () => {
  const index = roleIndex([READER, KEYS], []);
  expect(keptRoles(['r1', 'r2'], index, ['view-users'], 'acme')).toEqual(['r2']);
  expect(keptRoles(['r1', 'r2'], index, ['manage-keys'], 'acme')).toEqual([]);
});

it('keeps nothing for a role it has no record of', () => {
  const index = roleIndex([], []);
  expect(keptRoles(['r8'], index, [], 'acme')).toEqual([]);
});
