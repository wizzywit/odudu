import { describe, expect, it } from 'vitest';
import {
  defaultBlock,
  GROUP_TABS,
  groupHref,
  groupReach,
  groupRecord,
  groupRolesRecord,
  groupsHref,
  groupsTrail,
  moveRefusal,
  moveUnavailable,
  newGroupHref,
  reachLines,
  roleUnavailable,
  selfLoss,
  TAB_RECORDS,
} from '#/features/groups/service.ts';

function group(id: string, path: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: path.split('/').at(-1) ?? path,
    description: null,
    parent_id: null,
    default_for_new_subjects: false,
    path,
    created_at: '2026-09-28T08:41:53.858Z',
    ...extra,
  };
}

const admin = (name: string) => ({
  id: `r-${name}`,
  name,
  client_id: 'c',
  client_key: 'odudu-admin',
});
const plain = (name: string) => ({ id: `r-${name}`, name, client_id: null, client_key: null });

describe('addresses', () => {
  it('puts a group under its tenant, and a new one under the parent it was asked from', () => {
    expect(groupsHref('acme')).toBe('/console/acme/groups');
    expect(groupHref('acme', 'g 1')).toBe('/console/acme/groups/g%201');
    expect(newGroupHref('acme')).toBe('/console/acme/groups/new');
    expect(newGroupHref('acme', 'g-eng')).toBe('/console/acme/groups/new?parent=g-eng');
    expect(groupsTrail('acme', '/eng')).toEqual([
      { label: 'Identity' },
      { label: 'Groups', href: '/console/acme/groups' },
      { label: '/eng' },
    ]);
  });

  it('gives each tab the records its sections edit', () => {
    expect(GROUP_TABS).toEqual(['general', 'roles', 'members', 'activity']);
    expect(TAB_RECORDS.general('g')).toEqual([groupRecord('g')]);
    expect(TAB_RECORDS.roles('g')).toEqual([groupRolesRecord('g')]);
  });
});

describe('moving a group', () => {
  const eng = group('g-eng', '/eng');
  it('never offers the group itself or anything beneath it as its parent', () => {
    expect(moveUnavailable(eng, eng)).toBe('the group itself');
    expect(moveUnavailable(eng, group('g-p', '/eng/platform'))).toBe(
      'beneath /eng, so the move would make a loop',
    );
    expect(moveUnavailable(eng, group('g-x', '/engineering'))).toBeNull();
  });

  it('says what a refused move means where it was made', () => {
    expect(
      moveRefusal({
        type: 'about:blank',
        status: 409,
        detail: 'would create a group reparent cycle',
      }),
    ).toBe(
      'Refused: the parent chosen sits beneath this group, so the move would make a loop. Nothing was changed.',
    );
    expect(
      moveRefusal({
        type: 'about:blank',
        status: 403,
        detail: 'the caller does not hold: view-users',
      }),
    ).toBe('Refused: it would hand out view-users, which you do not hold yourself.');
  });
});

describe('what a group hands out', () => {
  it('splits what it maps itself from what the groups above it hand down', () => {
    const reach = groupReach('acme', [
      { group: group('g-top', '/top'), roles: [admin('manage-users')] },
      { group: group('g-mid', '/top/mid'), roles: [plain('auditor'), admin('view-audit')] },
    ]);
    expect(reach).toEqual({ own: ['view-audit'], inherited: ['view-users', 'manage-users'] });
  });

  it('says what the caller may not do, beside what holds it back', () => {
    expect(
      reachLines('/top/mid', { own: ['view-audit'], inherited: ['manage-users'] }, ['view-audit']),
    ).toEqual({
      move: 'The groups above /top/mid hand out manage-users, which you do not hold, so you cannot move it: its members would lose that.',
      remove:
        'Its members hold manage-users through it, which you do not hold, so you cannot delete it.',
    });
    expect(reachLines('/top', { own: [], inherited: [] }, [])).toEqual({
      move: null,
      remove: null,
    });
  });

  it('holds a default back while what it hands out reaches an admin capability', () => {
    expect(defaultBlock({ own: [], inherited: ['view-users'] }, false)).toBe(
      'Every new subject would join it and so receive view-users, and a group every new subject joins may reach no admin capability. Take those roles off it, or off the groups above it, first.',
    );
    expect(defaultBlock({ own: [], inherited: [] }, false)).toBeNull();
    // Turning it off is never refused.
    expect(defaultBlock({ own: ['view-users'], inherited: [] }, true)).toBeNull();
  });

  it('says why a role cannot be given or taken here', () => {
    expect(roleUnavailable(admin('manage-keys'), ['view-users'], false, 'acme')).toBe(
      'You do not hold manage-keys, so you cannot give or take it.',
    );
    expect(roleUnavailable(admin('view-users'), ['view-users'], true, 'acme')).toBe(
      'Every new subject joins this group, so it may hand out no admin capability.',
    );
    expect(roleUnavailable(plain('auditor'), [], true, 'acme')).toBeNull();
  });
});

describe('what a write here takes from yourself', () => {
  const via = (path: string) => ({
    kind: 'group' as const,
    group_id: `g${path}`,
    group_path: path,
  });
  const held = (name: string, ...paths: string[]) => ({
    id: `r-${name}`,
    name,
    client_id: 'c',
    client_key: 'odudu-admin',
    via: paths.map(via),
  });
  const own = [
    held('manage-users', '/eng'),
    held('view-audit', '/eng/platform'),
    held('manage-keys', '/top'),
    held('manage-clients', '/finance'),
  ];

  // Which group the principal belongs to is not read, so a group above
  // counts as one its membership may run through.
  it('counts every group above and beneath a deleted one, and those alone', () => {
    expect(selfLoss(own, { kind: 'delete', path: '/eng' })).toEqual(['manage-users', 'view-audit']);
    expect(selfLoss(own, { kind: 'delete', path: '/eng/platform' })).toEqual([
      'manage-users',
      'view-audit',
    ]);
    expect(selfLoss(own, { kind: 'delete', path: '/finance' })).toEqual(['manage-clients']);
  });

  it('counts what the groups above hand down when a group moves', () => {
    expect(selfLoss([held('manage-keys', '/top')], { kind: 'move', path: '/top/mid' })).toEqual([
      'manage-keys',
    ]);
    expect(selfLoss([held('manage-keys', '/top/mid')], { kind: 'move', path: '/top/mid' })).toEqual(
      [],
    );
  });

  it('counts the roles taken off a group, as mapped there', () => {
    expect(
      selfLoss(own, { kind: 'roles', path: '/eng', removed: ['r-manage-users', 'r-view-audit'] }),
    ).toEqual(['manage-users']);
  });
});
