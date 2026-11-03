import { describe, expect, it } from 'vitest';
import { SUBJECT_TAB_LABELS, subjectTabEntries } from '#/pages/subjects/services/tabs';
import { SUBJECT_TABS } from '#/entities/subject';

describe('the record tabs', () => {
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
});

describe('characterisation: the subject tab labels', () => {
  it.each([
    ['profile', 'Profile'],
    ['credentials', 'Credentials'],
    ['groups', 'Groups'],
    ['roles', 'Roles'],
    ['required-actions', 'Required actions'],
    ['sessions', 'Sessions'],
    ['consents', 'Consents'],
    ['grants', 'Grants'],
    ['activity', 'Activity'],
  ] as const)('%s is labelled %s', (tab, label) => {
    expect(SUBJECT_TAB_LABELS[tab]).toBe(label);
  });
});

describe('subjectTabEntries', () => {
  it('labels each tab in the order given and marks the ones holding unsaved edits', () => {
    expect(subjectTabEntries(['profile', 'roles'], new Set(['roles']))).toEqual([
      { id: 'profile', label: 'Profile', dirty: false },
      { id: 'roles', label: 'Roles', dirty: true },
    ]);
  });
});
