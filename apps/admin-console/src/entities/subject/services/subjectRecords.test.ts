import { describe, expect, it } from 'vitest';
import { SUBJECT_TABS, subjectTabHref } from '#/entities/subject/services/subjectAddress';
import {
  actionsRecord,
  groupsRecord,
  profileRecord,
  rolesRecord,
  SUBJECT_TAB_RECORDS,
  subjectRecord,
} from '#/entities/subject/services/subjectRecords';

describe('the records each tab edits', () => {
  it('names, for every tab, the records whose sections it edits', () => {
    expect(Object.keys(SUBJECT_TAB_RECORDS).sort()).toEqual([...SUBJECT_TABS].sort());
    expect(SUBJECT_TAB_RECORDS.profile('s1')).toEqual([subjectRecord('s1'), profileRecord('s1')]);
    expect(SUBJECT_TAB_RECORDS.credentials('s1')).toEqual([]);
    expect(SUBJECT_TAB_RECORDS.groups('s1')).toEqual([groupsRecord('s1')]);
    expect(SUBJECT_TAB_RECORDS.roles('s1')).toEqual([rolesRecord('s1')]);
    expect(SUBJECT_TAB_RECORDS['required-actions']('s1')).toEqual([actionsRecord('s1')]);
    expect(SUBJECT_TAB_RECORDS.sessions('s1')).toEqual([]);
  });

  it.each([
    ['profile', ['subjects/s', 'subjects/s/profile']],
    ['credentials', []],
    ['groups', ['subjects/s/groups']],
    ['roles', ['subjects/s/roles']],
    ['required-actions', ['subjects/s/required-actions']],
    ['sessions', []],
    ['consents', []],
    ['grants', []],
    ['activity', []],
  ] as const)('%s edits %j and is addressed by tab', (tab, records) => {
    expect(SUBJECT_TAB_RECORDS[tab]('s')).toEqual(records);
    expect(subjectTabHref('acme', 's', tab)).toBe(`/console/acme/subjects/s?tab=${tab}`);
  });
});
