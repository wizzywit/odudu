import { describe, expect, it } from 'vitest';
import {
  GROUP_TABS,
  GROUP_TAB_LABELS,
  groupRecord,
  groupRolesRecord,
  TAB_RECORDS,
} from '#/features/groups/services/tabs';

describe('addresses', () => {
  it('gives each tab the records its sections edit', () => {
    expect(GROUP_TABS).toEqual(['general', 'roles', 'members', 'activity']);
    expect(TAB_RECORDS.general('g')).toEqual([groupRecord('g')]);
    expect(TAB_RECORDS.roles('g')).toEqual([groupRolesRecord('g')]);
  });
});

describe('characterisation: the group tabs', () => {
  it.each([
    ['general', 'General', ['groups/g']],
    ['roles', 'Roles', ['groups/g/roles']],
    ['members', 'Members', []],
    ['activity', 'Activity', []],
  ] as const)('%s is labelled %s and edits %j', (tab, label, records) => {
    expect(GROUP_TAB_LABELS[tab]).toBe(label);
    expect(TAB_RECORDS[tab]('g')).toEqual(records);
  });
});
