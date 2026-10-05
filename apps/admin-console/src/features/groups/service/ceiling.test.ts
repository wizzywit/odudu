import type { AdminCapability } from '#/shared/service/principal.ts';
import { describe, expect, it } from 'vitest';
import {
  createHeld,
  createUnderHref,
  groupCeiling,
  groupReadiness,
  newGroupPlace,
  parentPathOf,
  parentPlace,
  ceilingCaller,
  ceilingLines,
  ceilingParentReach,
  placeText,
} from '#/features/groups/service/ceiling.ts';

function reach(...capabilities: AdminCapability[]): AdminCapability[] {
  return capabilities;
}

function group(id: string, path: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: path.split('/').at(-1) ?? path,
    description: null,
    parent_id: null,
    default_for_new_subjects: false,
    path,
    created_at: '2026-09-28T08:41:53.858Z',
    ...extra,
  };
}

describe('making a group', () => {
  const eng = { ...group('g-eng', '/eng'), admin_reach: reach('manage-users', 'view-users') };
  it('waits for the parent and the caller to be read, then holds a parent beyond the caller', () => {
    expect(createHeld('g-eng', undefined, reach('manage-users'))).toBe(
      'Checking what the parent hands out first.',
    );
    expect(createHeld(null, undefined, undefined)).toBe(
      'Checking what the parent hands out first.',
    );
    expect(createHeld('g-eng', eng, reach('manage-users'))).toBe(
      'A group made under /eng hands its members view-users, which you do not hold, so you cannot make one there.',
    );
    expect(createHeld('g-eng', eng, reach('manage-users', 'view-users'))).toBeNull();
    expect(createHeld(null, undefined, reach())).toBeNull();
  });

  it('says where the group sits, as it will and as it is', () => {
    expect(placeText(null, 'will')).toBe('It will sit at the top level.');
    expect(placeText('/eng', 'will')).toBe('It will sit under /eng.');
    expect(placeText(null, 'is')).toBe('At the top level.');
    expect(placeText('/eng', 'is')).toBe('Under /eng.');
  });
});

describe('where a new group will sit', () => {
  it('is said once the parent is read, and at the top level for none', () => {
    expect(newGroupPlace(null, undefined)).toBe('It will sit at the top level.');
    expect(newGroupPlace('g-eng', undefined)).toBeNull();
    expect(newGroupPlace('g-eng', group('g-eng', '/eng'))).toBe('It will sit under /eng.');
  });
});

describe('where a group sits', () => {
  const ops = { path: '/eng/ops', parent_id: 'g-eng' };
  const known = new Map([['g-other', { path: '/other' }]]);
  it('reads the parent from the picker, then from the group own path, else names the id', () => {
    expect(parentPathOf(ops, null, known)).toBe('the top level');
    expect(parentPathOf(ops, 'g-other', known)).toBe('/other');
    expect(parentPathOf(ops, 'g-eng', known)).toBe('/eng');
    expect(parentPathOf({ path: '/ops', parent_id: 'g-root' }, 'g-root', known)).toBe('');
    expect(parentPathOf(ops, 'g-unknown', known)).toBe('g-unknown');
  });
});

describe('what a write waits for', () => {
  it('fails once the ceiling failed, and checks until it and the loss are known', () => {
    const none = { kind: 'none' } as const;
    expect(groupReadiness('failed', none)).toBe('failed');
    expect(groupReadiness('checking', none)).toBe('checking');
    expect(groupReadiness('ready', { kind: 'checking' })).toBe('checking');
    expect(groupReadiness('ready', none)).toBe('ready');
    expect(groupReadiness('ready', { kind: 'certain', lost: ['view-audit'] })).toBe('ready');
  });
});

describe('the ceiling of a group record', () => {
  const record = {
    ...group('g-eng', '/eng'),
    admin_reach: reach('view-audit'),
    subtree_admin_reach: reach(),
    holds_default_group: false,
  };
  const authority = { capabilities: reach('view-audit', 'manage-users'), crossTenant: false };
  const retry = (): void => undefined;

  it('fails with the parent read, and checks until all three are known', () => {
    expect(groupCeiling({ status: 'failed', retry }, authority, record)).toEqual({
      status: 'failed',
      retry,
    });
    expect(groupCeiling({ status: 'loading' }, authority, record)).toEqual({ status: 'checking' });
    expect(groupCeiling({ status: 'none' }, undefined, record)).toEqual({ status: 'checking' });
    expect(groupCeiling({ status: 'none' }, authority, undefined)).toEqual({ status: 'checking' });
  });

  it('takes the parent reach from the parent read, none at the top level', () => {
    const top = groupCeiling({ status: 'none' }, authority, record);
    expect(top).toMatchObject({ status: 'ready', parentReach: [], caller: authority.capabilities });
    const parent = { ...record, id: 'g-p', admin_reach: reach('manage-users') };
    expect(groupCeiling({ status: 'ready', group: parent }, authority, record)).toMatchObject({
      status: 'ready',
      parentReach: ['manage-users'],
    });
  });

  it('offers a group under this one only to a caller holding all it hands out', () => {
    const ready = groupCeiling({ status: 'none' }, authority, record);
    expect(createUnderHref('acme', record, ready)).toBe('/console/acme/groups/new?parent=g-eng');
    const narrow = groupCeiling(
      { status: 'none' },
      { ...authority, capabilities: reach('manage-users') },
      record,
    );
    expect(createUnderHref('acme', record, narrow)).toBeNull();
    expect(createUnderHref('acme', undefined, ready)).toBeNull();
    expect(createUnderHref('acme', record, { status: 'checking' })).toBeNull();
  });
});

describe('reading a ceiling', () => {
  const authority = { capabilities: reach('manage-users'), crossTenant: false };
  const record = {
    ...group('g-eng', '/eng'),
    admin_reach: reach(),
    subtree_admin_reach: reach('view-users'),
    holds_default_group: false,
  };
  const ready = groupCeiling({ status: 'none' }, authority, record);

  it('gives the caller, the parent reach and the lines once ready, and nothing before', () => {
    expect(ceilingCaller(ready)).toEqual(['manage-users']);
    expect(ceilingParentReach(ready)).toEqual([]);
    expect(ceilingLines(ready)?.remove).toContain('view-users');
    expect(ceilingCaller({ status: 'checking' })).toEqual([]);
    expect(ceilingParentReach({ status: 'checking' })).toEqual([]);
    expect(ceilingLines({ status: 'checking' })).toBeNull();
  });
});

describe('the place a parent id names', () => {
  it('is null for the top level, else the path as the group is read', () => {
    const ops = { path: '/eng/ops', parent_id: 'g-eng' };
    expect(parentPlace(ops, null, new Map())).toBeNull();
    expect(parentPlace(ops, 'g-eng', new Map())).toBe('/eng');
  });
});
