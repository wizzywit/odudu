import { describe, expect, it } from 'vitest';
import {
  ROLE_TABS,
  roleRecord,
  TAB_RECORDS,
  compositesRecord,
} from '#/features/roles/service/tabs.ts';

describe('addresses', () => {
  it('gives each tab the records its sections edit', () => {
    expect(ROLE_TABS).toEqual(['general', 'composites', 'members', 'activity']);
    expect(TAB_RECORDS.general('r')).toEqual([roleRecord('r')]);
    expect(TAB_RECORDS.composites('r')).toEqual([compositesRecord('r')]);
  });
});
