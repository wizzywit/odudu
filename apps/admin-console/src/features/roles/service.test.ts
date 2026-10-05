import type { EffectiveRoleAssignment } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import {
  childUnavailable,
  compositeRefusal,
  copyHref,
  defaultBlock,
  deleteBlock,
  isBuiltin,
  newRoleHref,
  removalBlock,
  ROLE_TABS,
  roleHref,
  roleRecord,
  rolesHref,
  rolesTrail,
  roleSelfLoss,
  TAB_RECORDS,
  compositesRecord,
} from '#/features/roles/service.ts';

function role(id: string, name: string, clientKey: string | null = null, extra = {}) {
  return {
    id,
    name,
    description: null,
    client_id: clientKey === null ? null : `c-${clientKey}`,
    client_key: clientKey,
    default_for_new_subjects: false,
    created_at: '2026-09-28T08:41:53.858Z',
    ...extra,
  };
}

const AUDITOR = role('r-aud', 'auditor');
const READER = role('r-read', 'reader');
const USERS = role('r-users', 'manage-users', 'odudu-admin');
const FULL = role('r-full', 'tenant-admin', 'odudu-admin');

describe('addresses', () => {
  it('puts a role under its tenant, and a copy beside a new one', () => {
    expect(rolesHref('acme')).toBe('/console/acme/roles');
    expect(roleHref('acme', 'r 1')).toBe('/console/acme/roles/r%201');
    expect(newRoleHref('acme')).toBe('/console/acme/roles/new');
    expect(copyHref('acme', 'r-aud')).toBe('/console/acme/roles/new?copy=r-aud');
    expect(rolesTrail('acme', 'auditor')).toEqual([
      { label: 'Identity' },
      { label: 'Roles', href: '/console/acme/roles' },
      { label: 'auditor' },
    ]);
  });

  it('gives each tab the records its sections edit', () => {
    expect(ROLE_TABS).toEqual(['general', 'composites', 'members', 'activity']);
    expect(TAB_RECORDS.general('r')).toEqual([roleRecord('r')]);
    expect(TAB_RECORDS.composites('r')).toEqual([compositesRecord('r')]);
  });
});

describe('the built-in roles', () => {
  it('are the roles of the built-in admin client, whatever their name', () => {
    expect(isBuiltin(USERS)).toBe(true);
    expect(isBuiltin(role('r-x', 'manage-users', 'portal'))).toBe(false);
  });

  it('are never deleted, never made a default and keep their composites', () => {
    expect(deleteBlock('acme', USERS, [], [])).toBe(
      'manage-users is a capability of the built-in admin client, so it cannot be deleted: every administrator holding it would lose it.',
    );
    expect(defaultBlock('acme', USERS, [])).toBe(
      'A capability of the built-in admin client is never handed to every new subject.',
    );
  });
});

describe('the ceiling on a role', () => {
  it('holds a delete back when what the role reaches is beyond the caller', () => {
    expect(deleteBlock('acme', AUDITOR, [USERS], ['manage-tenant'])).toBe(
      'auditor reaches view-users and manage-users, which you do not hold, so you cannot delete it.',
    );
    expect(deleteBlock('acme', AUDITOR, [READER], ['manage-tenant'])).toBeNull();
  });

  it('holds a default back while the role reaches an admin capability', () => {
    expect(defaultBlock('acme', AUDITOR, [USERS])).toBe(
      'It reaches view-users and manage-users, and a role every new subject receives may reach no admin capability. Take those composites out of it first.',
    );
    expect(defaultBlock('acme', AUDITOR, [READER])).toBeNull();
    expect(
      defaultBlock('acme', { ...AUDITOR, default_for_new_subjects: true }, [USERS]),
    ).toBeNull();
  });

  it('says why a role cannot be nested here, or taken out', () => {
    expect(childUnavailable(AUDITOR, AUDITOR, [], ['manage-users'], 'acme')).toBe(
      'this role itself',
    );
    expect(childUnavailable(AUDITOR, READER, [READER], ['manage-users'], 'acme')).toBe(
      'nested here already',
    );
    expect(childUnavailable(AUDITOR, FULL, [], ['manage-users'], 'acme')).toBe(
      'Full carries capabilities you do not hold, so you cannot give or take it.',
    );
    expect(
      childUnavailable(
        { ...AUDITOR, default_for_new_subjects: true },
        USERS,
        [],
        ['manage-users'],
        'acme',
      ),
    ).toBe('Every new subject receives this role, so it may nest no admin capability.');
    expect(removalBlock(USERS, ['view-users'], 'acme')).toBe(
      'You do not hold manage-users, so you cannot give or take it.',
    );
    expect(removalBlock(READER, [], 'acme')).toBeNull();
  });

  it('says what a refused nesting means where it was asked', () => {
    expect(
      compositeRefusal('reader', {
        type: 'about:blank',
        status: 409,
        detail: 'would create a role composite cycle',
      }),
    ).toBe('Refused: reader already includes this role, so nesting it here would make a loop.');
    expect(compositeRefusal('reader', { type: 'about:blank', status: 409, detail: 'no' })).toBe(
      'Refused: no.',
    );
  });
});

describe('what a role write takes from yourself', () => {
  const own: EffectiveRoleAssignment[] = [
    { id: 'r-aud', name: 'auditor', client_id: null, client_key: null, via: [{ kind: 'direct' }] },
    {
      id: 'r-users',
      name: 'manage-users',
      client_id: 'c',
      client_key: 'odudu-admin',
      via: [{ kind: 'composite', parent_role_id: 'r-aud', parent_name: 'auditor' }],
    },
  ];

  it('counts what is held only through a deleted role, or an edge taken out', () => {
    expect(roleSelfLoss(own, { kind: 'delete', id: 'r-aud' })).toEqual(['manage-users']);
    expect(roleSelfLoss(own, { kind: 'remove', id: 'r-aud', child: 'r-users' })).toEqual([
      'manage-users',
    ]);
    expect(roleSelfLoss(own, { kind: 'remove', id: 'r-other', child: 'r-users' })).toEqual([]);
  });
});
