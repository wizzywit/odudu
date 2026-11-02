import { describe, expect, it } from 'vitest';
import {
  dirtyTabs,
  entryEtag,
  etagOfRead,
  recordsWithEdits,
  recordTabs,
  recordView,
  seenAfter,
  sectionKey,
  sectionsOf,
  shownFailure,
  tabNamed,
} from '#/shared/services/record';

const TABS = ['general', 'roles', 'activity'] as const;

describe('tabNamed', () => {
  it('finds the tab of that name, and nothing for a name the record lacks', () => {
    expect(tabNamed(TABS, 'roles')).toBe('roles');
    expect(tabNamed(TABS, 'nope')).toBeUndefined();
    expect(tabNamed(TABS, null)).toBeUndefined();
  });
});

describe('dirtyTabs', () => {
  const recordsOf = (tab: (typeof TABS)[number]): string[] =>
    tab === 'general' ? ['g/1', 'g/1/x'] : tab === 'roles' ? ['r/1'] : [];
  it('carries a dot on each tab whose records have unsaved sections', () => {
    expect([...dirtyTabs(TABS, recordsOf, new Set(['r/1']))]).toEqual(['roles']);
    expect([...dirtyTabs(TABS, recordsOf, new Set())]).toEqual([]);
    expect([...dirtyTabs(TABS, recordsOf, new Set(['g/1/x', 'r/1']))]).toEqual([
      'general',
      'roles',
    ]);
  });
});

describe('sectionKey', () => {
  it('names a section by tenant, record and section', () => {
    expect(sectionKey('acme', 'groups/1', 'general')).toBe('acme/groups/1#general');
  });
});

describe('sectionsOf', () => {
  it("reads back the section ids of one record's keys, and no other record's", () => {
    const keys = [
      sectionKey('acme', 'groups/1', 'general'),
      sectionKey('acme', 'groups/1', 'roles'),
      sectionKey('acme', 'groups/10', 'general'),
      sectionKey('other', 'groups/1', 'general'),
    ];
    expect([...sectionsOf(keys, 'acme', 'groups/1')]).toEqual(['general', 'roles']);
  });

  it('finds none for a record there is not', () => {
    expect(sectionsOf([sectionKey('acme', 'groups/1', 'general')], 'acme', null).size).toBe(0);
  });
});

describe('recordView', () => {
  const read = {
    result: { ok: true as const, status: 200, data: 1, etag: 'e1', next: null },
    by: 'read' as const,
  };
  const missing = {
    ok: false as const,
    kind: 'problem' as const,
    problem: { type: 'about:blank', title: 'Not Found', status: 404 },
  };
  const broken = { ok: false as const, kind: 'network' as const };

  it('is loading until the first read answers', () => {
    expect(recordView(undefined, null, null)).toMatchObject({
      status: 'loading',
      updated: false,
      gone: false,
      refreshFailed: false,
    });
  });
  it('is ready with the record, and failed or missing when the first read failed', () => {
    expect(recordView(read, null, 'e1').status).toBe('ready');
    expect(recordView(undefined, broken, null).status).toBe('failed');
    expect(recordView(undefined, missing, null).status).toBe('missing');
  });
  it('is updated when the ETag moved past the one acknowledged', () => {
    expect(recordView(read, null, 'e0').updated).toBe(true);
    expect(recordView(read, null, 'e1').updated).toBe(false);
    expect(recordView(read, null, null).updated).toBe(false);
  });
  it('keeps the record on screen after a failed re-read, and says it is gone when that was a 404', () => {
    expect(recordView(read, broken, 'e1')).toMatchObject({
      status: 'ready',
      refreshFailed: true,
      gone: false,
    });
    expect(recordView(read, missing, 'e1')).toMatchObject({ refreshFailed: true, gone: true });
  });
});

describe('seenAfter', () => {
  it('adopts the first ETag and any ETag a save wrote, and ignores another reader', () => {
    expect(seenAfter(null, 'e1', 'read')).toBe('e1');
    expect(seenAfter('e1', 'e2', 'read')).toBe('e1');
    expect(seenAfter('e1', 'e2', 'save')).toBe('e2');
    expect(seenAfter('e1', null, 'save')).toBe('e1');
    expect(seenAfter('e1', 'e1', 'save')).toBe('e1');
  });
});

describe('recordsWithEdits', () => {
  it('names the records with an unsaved section, in the order asked, by exact record', () => {
    const keys = [
      sectionKey('acme', 'groups/1', 'general'),
      sectionKey('acme', 'groups/1/roles', 'roles'),
      sectionKey('other', 'groups/2', 'general'),
    ];
    const asked = ['groups/2', 'groups/1', 'groups/1/roles', 'groups/10'];
    expect([...recordsWithEdits(keys, 'acme', asked)]).toEqual(['groups/1', 'groups/1/roles']);
    expect([...recordsWithEdits([], 'acme', asked)]).toEqual([]);
  });
});

describe('entryEtag and shownFailure', () => {
  const entry = { result: { etag: 'e1' }, by: 'read' as const };
  const broken = { ok: false as const, kind: 'network' as const };

  it('takes the ETag off the entry, or none before a first read', () => {
    expect(entryEtag(entry)).toBe('e1');
    expect(entryEtag({ result: { etag: null }, by: 'save' })).toBeNull();
    expect(entryEtag(undefined)).toBeNull();
  });
  it('shows a failure only while the read is in error', () => {
    expect(shownFailure(true, broken)).toBe(broken);
    expect(shownFailure(false, broken)).toBeNull();
    expect(shownFailure(true, null)).toBeNull();
  });
});

describe('etagOfRead', () => {
  it('is the tag a successful read answered with, and none from a failure or no tag', () => {
    expect(etagOfRead({ ok: true, status: 200, data: 1, etag: 'e1', next: null })).toBe('e1');
    expect(etagOfRead({ ok: true, status: 200, data: 1, etag: null, next: null })).toBeNull();
    expect(etagOfRead({ ok: false, kind: 'network' })).toBeNull();
    expect(etagOfRead(undefined)).toBeNull();
  });
});

describe('recordTabs', () => {
  const model = recordTabs({
    tabs: TABS,
    labels: { general: 'General', roles: 'Roles', activity: 'Activity' },
    sections: { general: ['name', 'note'], roles: ['held'], activity: [] },
  });
  const href = model.hrefOf((tenant, id) => `/console/${tenant}/things/${id}`);

  it('keeps the tabs and labels it was given, in order', () => {
    expect(model.tabs.map((tab) => model.labels[tab])).toEqual(['General', 'Roles', 'Activity']);
  });

  it('names a tab, and none for a name the record lacks', () => {
    expect(model.named('roles')).toBe('roles');
    expect(model.named('nope')).toBeUndefined();
  });

  it('addresses one tab under the record, encoding what the record address encodes', () => {
    expect(href('acme', 'x', 'roles')).toBe('/console/acme/things/x?tab=roles');
  });

  it('holds a section of its own in the dirty set it is given, and none in another', () => {
    expect(model.holds('general', new Set(['note']))).toBe(true);
    expect(model.holds('roles', new Set(['note']))).toBe(false);
    expect(model.holds('activity', new Set(['note']))).toBe(false);
    expect(model.holds('general', undefined)).toBe(false);
  });

  it('lists the edited tabs in the order shown', () => {
    expect([...model.edited((tab) => tab !== 'roles')]).toEqual(['general', 'activity']);
  });
});
