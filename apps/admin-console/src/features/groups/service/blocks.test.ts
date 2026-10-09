import type { AdminCapability } from '#/shared/service/principal.ts';
import { describe, expect, it } from 'vitest';
import {
  defaultBlock,
  defaultingOf,
  moveRefusal,
  moveUnavailable,
  reachLines,
  parentUnavailable,
  roleUnavailable,
} from '#/features/groups/service/blocks.ts';

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
