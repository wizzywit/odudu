import type { AdminCapability } from '#/shared/service/principal.ts';
import { describe, expect, it } from 'vitest';
import {
  defaultBlock,
  defaultingOf,
  GROUP_TABS,
  groupHref,
  groupRecord,
  groupRolesRecord,
  groupsHref,
  groupsTrail,
  moveRefusal,
  moveUnavailable,
  newGroupHref,
  reachLines,
  parentUnavailable,
  lossOf,
  lossText,
  possibleLoss,
  roleUnavailable,
  selfLoss,
  TAB_RECORDS,
} from '#/features/groups/service.ts';

function reach(...capabilities: AdminCapability[]): AdminCapability[] {
  return capabilities;
}

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
    expect(
      moveRefusal({
        type: 'about:blank',
        status: 409,
        detail: 'a group named "ops" already exists there',
      }),
    ).toBe(
      'Refused: the parent chosen already holds a group named "ops", and two groups beside each other cannot share a name. Nothing was changed.',
    );
  });
});

describe('what a group hands out', () => {
  const record = (extra: Record<string, unknown> = {}) => ({
    ...group('g-mid', '/top/mid'),
    admin_reach: reach('view-audit'),
    subtree_admin_reach: reach('manage-keys', 'view-audit'),
    holds_default_group: false,
    ...extra,
  });

  it('says what the caller may not do, beside what holds it back', () => {
    expect(reachLines(record(), ['manage-users'], ['view-audit'])).toEqual({
      move: 'The groups above /top/mid hand out manage-users, which you do not hold, so you cannot move it: its members would lose that.',
      remove:
        'Its members hold manage-keys through it, which you do not hold, so you cannot delete it.',
    });
    expect(reachLines(record(), [], ['view-audit', 'manage-keys'])).toEqual({
      move: null,
      remove: null,
    });
  });

  it('holds a default back while what it hands out reaches an admin capability', () => {
    expect(defaultBlock(record())).toBe(
      'Every new subject would join it and so receive view-audit, and a group every new subject joins may reach no admin capability. Take those roles off it, or off the groups above it, first.',
    );
    expect(defaultBlock(record({ admin_reach: [] }))).toBeNull();
    // Turning it off is never refused.
    expect(defaultBlock(record({ default_for_new_subjects: true }))).toBeNull();
  });

  it('never offers a parent handing out what the caller lacks', () => {
    const top = { ...group('g-admins', '/admins'), admin_reach: reach('view-users') };
    expect(parentUnavailable(record(), top, ['view-audit'])).toBe(
      'its members receive view-users, which you do not hold',
    );
    expect(parentUnavailable(record(), top, ['view-users'])).toBeNull();
    expect(parentUnavailable(record(), { ...record(), admin_reach: [] }, [])).toBe(
      'the group itself',
    );
  });

  it('holds a group with a default beneath it out of a parent that hands out a capability', () => {
    const top = { ...group('g-admins', '/admins'), admin_reach: reach('view-users') };
    const holder = record({ holds_default_group: true });
    expect(parentUnavailable(holder, top, ['view-users'])).toBe(
      'its members receive view-users, and a group every new subject joins, or holds one beneath it, may reach no admin capability',
    );
    expect(parentUnavailable(holder, { ...top, admin_reach: [] }, [])).toBeNull();
  });

  it('names the default beneath a group as the reason a role cannot be given', () => {
    const bundle = { name: 'bundle', client_key: null, admin_reach: reach('view-users') };
    expect(roleUnavailable(bundle, ['view-users'], 'beneath', 'acme')).toBe(
      'Every new subject joins a group beneath this one and so receives what this one hands out, so it may hand out no admin capability.',
    );
    expect(defaultingOf({ default_for_new_subjects: false, holds_default_group: true })).toBe(
      'beneath',
    );
    expect(defaultingOf({ default_for_new_subjects: true, holds_default_group: true })).toBe(
      'itself',
    );
    expect(
      defaultingOf({ default_for_new_subjects: false, holds_default_group: false }),
    ).toBeNull();
  });

  it('says why a role cannot be given or taken here, however deep it nests a capability', () => {
    const reaching = (name: string, reach: string[], clientKey: string | null = null) => ({
      name,
      client_key: clientKey,
      admin_reach: reach,
    });
    expect(
      roleUnavailable(
        reaching('manage-keys', ['manage-keys'], 'odudu-admin'),
        ['view-users'],
        null,
        'acme',
      ),
    ).toBe('You do not hold manage-keys, so you cannot give or take it.');
    expect(roleUnavailable(reaching('bundle', ['view-audit']), ['view-users'], null, 'acme')).toBe(
      'It reaches view-audit, which you do not hold, so you cannot give or take it.',
    );
    expect(
      roleUnavailable(reaching('bundle', ['view-users']), ['view-users'], 'itself', 'acme'),
    ).toBe('Every new subject joins this group, so it may hand out no admin capability.');
    expect(roleUnavailable(reaching('auditor', []), [], 'itself', 'acme')).toBeNull();
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

  it('takes from a delete only what reaches you through groups inside it', () => {
    const roles = [held('manage-users', '/eng'), held('view-audit', '/eng/platform')];
    expect(
      selfLoss({ roles, groups: ['/eng/platform'] }, { kind: 'delete', path: '/eng/platform' }),
    ).toEqual(['manage-users', 'view-audit']);
    // A member of /eng itself keeps what /eng maps when /eng/platform goes.
    expect(
      selfLoss({ roles, groups: ['/eng'] }, { kind: 'delete', path: '/eng/platform' }),
    ).toEqual([]);
  });

  it('takes from a move what the groups above handed down, unless the new parent is under them', () => {
    const roles = [held('manage-keys', '/top')];
    const groups = ['/top/mid'];
    expect(selfLoss({ roles, groups }, { kind: 'move', path: '/top/mid', to: '/other' })).toEqual([
      'manage-keys',
    ]);
    expect(
      selfLoss({ roles, groups }, { kind: 'move', path: '/top/mid', to: '/top/elsewhere' }),
    ).toEqual([]);
    expect(
      selfLoss(
        { roles, groups: ['/top/mid', '/top'] },
        { kind: 'move', path: '/top/mid', to: null },
      ),
    ).toEqual([]);
  });

  it('takes the roles taken off a group, as mapped there', () => {
    const roles = [held('manage-users', '/eng'), held('view-audit', '/eng')];
    expect(
      selfLoss(
        { roles, groups: ['/eng'] },
        { kind: 'roles', path: '/eng', removed: ['r-manage-users'] },
      ),
    ).toEqual(['manage-users']);
  });

  it('asks without your own groups by what you hold that the write would take', () => {
    expect(possibleLoss(['view-audit', 'manage-keys'], ['manage-keys', 'view-users'])).toEqual([
      'manage-keys',
    ]);
  });
});

describe('the loss a write is asked about', () => {
  const roles = [
    {
      id: 'r-view-audit',
      name: 'view-audit',
      client_id: 'c',
      client_key: 'odudu-admin',
      via: [{ kind: 'group' as const, group_id: 'g', group_path: '/eng' }],
    },
  ];
  const change = { kind: 'delete' as const, path: '/eng' };

  it('waits while the principal’s own access is read', () => {
    expect(lossOf({ status: 'loading' }, [], change, [])).toEqual({ kind: 'checking' });
  });

  it('is certain from the principal’s own access, and possible from whoami alone', () => {
    const certain = lossOf({ status: 'ready', roles, groups: ['/eng'] }, [], change, []);
    expect(certain).toEqual({ kind: 'certain', lost: ['view-audit'] });
    expect(lossText(certain, 'these groups')).toBe(
      ' You hold view-audit through these groups, so this takes it from you, and this console with it.',
    );
    const possible = lossOf({ status: 'unknown' }, ['view-audit'], change, ['view-audit']);
    expect(lossText(possible, 'these groups')).toBe(
      ' If you hold view-audit through these groups, this takes it from you, and this console with it.',
    );
    expect(lossOf({ status: 'unknown' }, ['view-audit'], change, [])).toEqual({ kind: 'none' });
  });
});
