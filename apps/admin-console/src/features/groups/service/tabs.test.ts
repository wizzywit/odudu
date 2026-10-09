import { describe, expect, it } from 'vitest';
import {
  GROUP_TABS,
  groupRecord,
  groupRolesRecord,
  TAB_RECORDS,
} from '#/features/groups/service/tabs.ts';

describe('addresses', () => {
  it('gives each tab the records its sections edit', () => {
    expect(GROUP_TABS).toEqual(['general', 'roles', 'members', 'activity']);
    expect(TAB_RECORDS.general('g')).toEqual([groupRecord('g')]);
    expect(TAB_RECORDS.roles('g')).toEqual([groupRolesRecord('g')]);
  });
});
