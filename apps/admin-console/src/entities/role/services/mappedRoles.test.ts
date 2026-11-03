import { describe, expect, it } from 'vitest';
import type { AdminCapability } from '#/shared/lib/services/principal';
import {
  assignedRoles,
  assignmentsOf,
  byNameThenClient,
  keptMapped,
  keptRoles,
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

describe('the roles kept on a record', () => {
  const caller = (...capabilities: AdminCapability[]) => capabilities;
  const MAPPED = [
    { id: 'r1', name: 'reader', client_key: null, admin_reach: caller() },
    { id: 'r2', name: 'keeper', client_key: null, admin_reach: caller('manage-keys') },
    { id: 'r3', name: 'users', client_key: 'k', admin_reach: caller('manage-users') },
  ];

  it('keeps a mapped role the caller could not give, though the picker has not loaded it', () => {
    expect(keptRoles(MAPPED, caller('view-users'), 'acme')).toEqual(['r2', 'r3']);
    expect(keptRoles(MAPPED.slice(0, 2), caller('manage-keys'), 'acme')).toEqual([]);
  });

  it('selects the same roles from the items of a scope and of a group, for any caller', () => {
    const items = MAPPED.map((role) => ({ ...role, client_id: null, description: null }));
    for (const who of [caller(), caller('manage-keys'), caller('manage-keys', 'manage-users')]) {
      expect(keptRoles(items, who, 'acme')).toEqual(keptRoles(MAPPED, who, 'acme'));
    }
    expect(keptRoles(items, caller(), 'acme')).toEqual(['r2', 'r3']);
    expect(keptRoles(items, caller('manage-keys'), 'acme')).toEqual(['r3']);
  });

  it('reads the reach from a lookup when given, and keeps nothing for a role it has no record of', () => {
    const index = roleIndex(
      MAPPED.map((role) => ({ ...role, client_id: null })),
      [],
    );
    expect(keptRoles(MAPPED, caller('view-users'), 'acme', index)).toEqual(['r2', 'r3']);
    expect(keptRoles(MAPPED.slice(0, 2), caller('manage-keys'), 'acme', index)).toEqual([]);
    expect(keptRoles(MAPPED, caller(), 'acme', roleIndex([], []))).toEqual([]);
    const overridden = roleIndex(
      MAPPED.map((role) => ({ ...role, client_id: null })),
      [
        {
          id: 'r1',
          name: 'reader',
          client_key: null,
          client_id: null,
          description: null,
          admin_reach: caller('manage-keys'),
        },
      ],
    );
    expect(keptRoles(MAPPED.slice(0, 1), caller(), 'acme', overridden)).toEqual(['r1']);
    expect(keptRoles(MAPPED.slice(0, 1), caller(), 'acme')).toEqual([]);
  });

  it('keeps the mapped roles a group caller could not give', () => {
    const group = [
      { id: 'r1', name: 'auditor', client_key: 'k', admin_reach: caller('view-audit') },
      { id: 'r2', name: 'plain', client_key: null, admin_reach: caller() },
    ];
    expect(keptRoles(group, caller('manage-users'), 'acme')).toEqual(['r1']);
    expect(keptRoles(group, caller('view-audit'), 'acme')).toEqual([]);
  });

  it('judges by the entry or by the index according to where the reach is read from', () => {
    const entry = { id: 'r1', name: 'reader', client_key: null, admin_reach: caller() };
    const index = roleIndex(
      [{ ...entry, client_id: null }],
      [{ ...entry, client_id: null, description: null, admin_reach: caller('manage-keys') }],
    );
    expect(keptMapped([entry], caller(), 'acme', index, 'entry')).toEqual([]);
    expect(keptMapped([entry], caller(), 'acme', index, 'picker')).toEqual(['r1']);
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
