import type { AdminCapability } from '#/shared/service/principal.ts';
import { describe, expect, it } from 'vitest';
import {
  keptRoles,
  mappedRoles,
  reachOfRoles,
  roleIndex,
  withKept,
} from '#/features/groups/service/mapped.ts';

function reach(...capabilities: AdminCapability[]): AdminCapability[] {
  return capabilities;
}

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
  const options = [
    {
      id: 'r2',
      name: 'plain',
      description: 'Plain',
      client_id: null,
      client_key: null,
      default_for_new_subjects: false,
      created_at: '2026-09-28T08:41:53.858Z',
      admin_reach: reach(),
    },
  ];

  it('indexes the mapped roles, the picker overriding with its description', () => {
    const index = roleIndex(items, options);
    expect(index.get('r1')).toEqual({
      id: 'r1',
      name: 'auditor',
      client_id: 'c',
      client_key: 'k',
      description: null,
    });
    expect(index.get('r2')?.description).toBe('Plain');
  });

  it('names an unknown id by itself', () => {
    expect(mappedRoles(['r1', 'zz'], roleIndex(items, [])).map((each) => each.name)).toEqual([
      'auditor',
      'zz',
    ]);
    expect(mappedRoles(['zz'], roleIndex(items, []))[0]).toEqual({
      id: 'zz',
      name: 'zz',
      client_id: null,
      client_key: null,
      description: null,
    });
  });

  it('keeps the mapped roles the caller could not give, and adds them to every choice', () => {
    expect(keptRoles(items, reach('manage-users'), 'acme')).toEqual(['r1']);
    expect(keptRoles(items, reach('view-audit'), 'acme')).toEqual([]);
    expect(withKept(['r2', 'r1'], ['r1'])).toEqual(['r1', 'r2']);
    expect(withKept([], ['r1', 'r1'])).toEqual(['r1']);
  });

  it('adds up what the removed roles hand out', () => {
    expect(reachOfRoles(items, ['r1', 'r2', 'gone'])).toEqual(['view-audit']);
  });
});
