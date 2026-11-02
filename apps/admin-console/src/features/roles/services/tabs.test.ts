import { describe, expect, it } from 'vitest';
import {
  ROLE_TABS,
  ROLE_TAB_LABELS,
  roleRecord,
  TAB_RECORDS,
  compositesRecord,
} from '#/features/roles/services/tabs';

describe('addresses', () => {
  it('gives each tab the records its sections edit', () => {
    expect(ROLE_TABS).toEqual(['general', 'composites', 'members', 'activity']);
    expect(TAB_RECORDS.general('r')).toEqual([roleRecord('r')]);
    expect(TAB_RECORDS.composites('r')).toEqual([compositesRecord('r')]);
  });
});

describe('characterisation: the role tabs', () => {
  it.each([
    ['general', 'General', ['roles/r']],
    ['composites', 'Composites', ['roles/r/composites']],
    ['members', 'Members', []],
    ['activity', 'Activity', []],
  ] as const)('%s is labelled %s and edits %j', (tab, label, records) => {
    expect(ROLE_TAB_LABELS[tab]).toBe(label);
    expect(TAB_RECORDS[tab]('r')).toEqual(records);
  });
});
