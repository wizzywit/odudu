import { describe, expect, it } from 'vitest';
import {
  assignedRoles,
  assignmentsOf,
  byNameThenClient,
  knownAssignments,
  mappedRoles,
  roleIndex,
  roleNameOf,
  withKept,
} from '#/entities/role/services/mappedRoles';

const REACH = ['view-audit'];
const ITEMS = [
  { id: 'r1', name: 'auditor', client_id: 'c', client_key: 'k', admin_reach: REACH },
  { id: 'r2', name: 'plain', client_id: null, client_key: null, admin_reach: [] },
];
const OPTIONS = [
  {
    id: 'r2',
    name: 'plain',
    description: 'Plain',
    client_id: null,
    client_key: null,
    admin_reach: [],
  },
];

describe('the roles mapped to a record', () => {
  it('indexes the mapped roles, the picker overriding with its description', () => {
    const index = roleIndex(ITEMS, OPTIONS);
    expect(index.get('r1')).toEqual({
      id: 'r1',
      name: 'auditor',
      client_id: 'c',
      client_key: 'k',
      description: null,
      admin_reach: REACH,
    });
    expect(index.get('r2')?.description).toBe('Plain');
  });

  it('lists the roles without what they reach, naming an unknown id by itself', () => {
    expect(mappedRoles(['r1', 'zz'], roleIndex(ITEMS, []))).toEqual([
      { id: 'r1', name: 'auditor', client_id: 'c', client_key: 'k', description: null },
      { id: 'zz', name: 'zz', client_id: null, client_key: null, description: null },
    ]);
  });

  it('adds the roles it must keep to every choice, sorted and once', () => {
    expect(withKept(['r2', 'r1'], ['r1'])).toEqual(['r1', 'r2']);
    expect(withKept([], ['r1', 'r1'])).toEqual(['r1']);
  });
});

describe('role assignments', () => {
  const known = knownAssignments(
    [{ id: 'r1', name: 'editor', client_key: null }],
    [{ id: 'r2', name: 'reader', client_key: 'web' }],
  );

  it('is known by name and client from the held list and the picker alike', () => {
    expect(assignmentsOf(['r1', 'r2', 'r3'], known)).toEqual([
      { id: 'r1', name: 'editor', client: null },
      { id: 'r2', name: 'reader', client: 'web' },
      { id: 'r3', name: 'r3', client: null },
    ]);
  });

  it('names a role by its id where none is known', () => {
    expect(roleNameOf(known)('r2')).toBe('reader');
    expect(roleNameOf(known)('gone')).toBe('gone');
  });

  it('orders by name, a tenant role before a client role of the same name', () => {
    expect(
      byNameThenClient([
        { id: 'c1', name: 'reader', client: 'billing' },
        { id: 't1', name: 'reader', client: null },
        { id: 'z', name: 'admin', client: null },
      ]).map((role) => role.id),
    ).toEqual(['z', 't1', 'c1']);
  });
});

describe('assignedRoles', () => {
  const TENANT = { id: 't1', name: 'reader', client_id: null, client_key: null };
  const CLIENT = { id: 'c1', name: 'reader', client_id: 'cc', client_key: 'billing' };

  it('lists them by name, a tenant role before a client role of the same name', () => {
    const known = knownAssignments([CLIENT, TENANT, { id: 'z', name: 'admin', client_key: null }]);
    expect(assignedRoles(['c1', 't1', 'z'], known)).toEqual([
      { id: 'z', name: 'admin', client: null },
      { id: 't1', name: 'reader', client: null },
      { id: 'c1', name: 'reader', client: 'billing' },
    ]);
  });

  it('names a role it has not seen by its id', () => {
    expect(assignedRoles(['gone'], knownAssignments())).toEqual([
      { id: 'gone', name: 'gone', client: null },
    ]);
  });
});
