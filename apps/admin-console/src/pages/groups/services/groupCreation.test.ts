import { describe, expect, it } from 'vitest';
import {
  createBlocked,
  createHeld,
  newGroupPlace,
  parentPathOf,
  parentPlace,
  placeText,
} from '#/pages/groups/services/groupCreation';
import { group } from '#/testing/groupAnswers';
import { reach } from '#/testing/roleAnswers';

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

describe('the place a parent id names', () => {
  it('is null for the top level, else the path as the group is read', () => {
    const ops = { path: '/eng/ops', parent_id: 'g-eng' };
    expect(parentPlace(ops, null, new Map())).toBeNull();
    expect(parentPlace(ops, 'g-eng', new Map())).toBe('/eng');
  });
});

describe('createBlocked', () => {
  it('holds Create while a write is under way or the parent hands out too much', () => {
    expect(createBlocked(false, null)).toBe(false);
    expect(createBlocked(true, null)).toBe(true);
    expect(createBlocked(false, 'Checking what the parent hands out first.')).toBe(true);
  });
});
