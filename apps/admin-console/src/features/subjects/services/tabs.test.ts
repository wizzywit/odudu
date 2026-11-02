import { describe, expect, it } from 'vitest';
import {
  actionsRecord,
  groupsRecord,
  profileRecord,
  rolesRecord,
  SUBJECT_TAB_LABELS,
  SUBJECT_TABS,
  subjectTabHref,
  subjectRecord,
  TAB_RECORDS,
} from '#/features/subjects/services/tabs';

describe('the record tabs', () => {
  it('names, for every tab, the records whose sections it edits', () => {
    expect(Object.keys(TAB_RECORDS).sort()).toEqual([...SUBJECT_TABS].sort());
    expect(TAB_RECORDS.profile('s1')).toEqual([subjectRecord('s1'), profileRecord('s1')]);
    expect(TAB_RECORDS.credentials('s1')).toEqual([]);
    expect(TAB_RECORDS.groups('s1')).toEqual([groupsRecord('s1')]);
    expect(TAB_RECORDS.roles('s1')).toEqual([rolesRecord('s1')]);
    expect(TAB_RECORDS['required-actions']('s1')).toEqual([actionsRecord('s1')]);
    expect(TAB_RECORDS.sessions('s1')).toEqual([]);
  });

  it('runs in the order the record page shows them', () => {
    expect(SUBJECT_TABS.map((tab) => SUBJECT_TAB_LABELS[tab])).toEqual([
      'Profile',
      'Credentials',
      'Groups',
      'Roles',
      'Required actions',
      'Sessions',
      'Consents',
      'Grants',
      'Activity',
    ]);
  });

  it('addresses one tab of a record', () => {
    expect(subjectTabHref('acme', 's 1', 'roles')).toBe('/console/acme/subjects/s%201?tab=roles');
  });
});

describe('characterisation: the subject tabs', () => {
  it.each([
    ['profile', 'Profile', ['subjects/s', 'subjects/s/profile']],
    ['credentials', 'Credentials', []],
    ['groups', 'Groups', ['subjects/s/groups']],
    ['roles', 'Roles', ['subjects/s/roles']],
    ['required-actions', 'Required actions', ['subjects/s/required-actions']],
    ['sessions', 'Sessions', []],
    ['consents', 'Consents', []],
    ['grants', 'Grants', []],
    ['activity', 'Activity', []],
  ] as const)('%s is labelled %s, edits %j and is addressed by tab', (tab, label, records) => {
    expect(SUBJECT_TAB_LABELS[tab]).toBe(label);
    expect(TAB_RECORDS[tab]('s')).toEqual(records);
    expect(subjectTabHref('acme', 's', tab)).toBe(`/console/acme/subjects/s?tab=${tab}`);
  });
});
