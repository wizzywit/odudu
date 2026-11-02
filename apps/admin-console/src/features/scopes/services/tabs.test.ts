import { expect, it } from 'vitest';
import {
  SCOPE_TAB_LABELS,
  SCOPE_TABS,
  TAB_RECORDS,
  scopeMappersRecord,
  scopeRecord,
  scopeRolesRecord,
} from '#/features/scopes/services/tabs';

it('has the five tabs in order, each labelled', () => {
  expect(SCOPE_TABS.map((tab) => SCOPE_TAB_LABELS[tab])).toEqual([
    'General',
    'Roles',
    'Claim mappers',
    'Clients',
    'Activity',
  ]);
});

it('follows the records each tab edits, so its dot can', () => {
  expect(TAB_RECORDS.general('s1')).toEqual([scopeRecord('s1')]);
  expect(TAB_RECORDS.roles('s1')).toEqual([scopeRolesRecord('s1')]);
  expect(TAB_RECORDS.mappers('s1')).toEqual([scopeMappersRecord('s1')]);
  expect(TAB_RECORDS.clients('s1')).toEqual([]);
  expect(TAB_RECORDS.activity('s1')).toEqual([]);
  expect(scopeRolesRecord('s1')).toBe('scopes/s1/roles');
});

it.each([
  ['general', 'General', ['scopes/s']],
  ['roles', 'Roles', ['scopes/s/roles']],
  ['mappers', 'Claim mappers', ['scopes/s/mappers']],
  ['clients', 'Clients', []],
  ['activity', 'Activity', []],
] as const)('characterisation: %s is labelled %s and edits %j', (tab, label, records) => {
  expect(SCOPE_TAB_LABELS[tab]).toBe(label);
  expect(TAB_RECORDS[tab]('s')).toEqual(records);
});
