import type { EffectiveRoleAssignment } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import type { AdminCapability } from '#/shared/service/principal.ts';
import {
  compositeRemovalConfirmation,
  compositeRemovalFailureText,
  unnestedText,
} from '#/features/roles/service/removal.ts';
import {
  compositesOffered,
  defaultsChecking,
  isDeleteHeld,
  roleCeiling,
  roleSelfLoss,
} from '#/features/roles/service/ceiling.ts';
import {
  childUnavailable,
  compositeRefusal,
  defaultBlock,
  deleteBlock,
  removalBlock,
} from '#/features/roles/service/blocks.ts';

function role(
  id: string,
  name: string,
  clientKey: string | null = null,
  reach: AdminCapability[] = [],
) {
  return {
    admin_reach: reach,
    id,
    name,
    description: null,
    client_id: clientKey === null ? null : `c-${clientKey}`,
    client_key: clientKey,
    default_for_new_subjects: false,
    created_at: '2026-09-28T08:41:53.858Z',
  };
}

const AUDITOR = role('r-aud', 'auditor');

const READER = role('r-read', 'reader');

const USERS = role('r-users', 'manage-users', 'odudu-admin', ['view-users', 'manage-users']);

const FULL = role('r-full', 'tenant-admin', 'odudu-admin', ['view-users', 'manage-users']);

// A tenant role nesting a capability two levels down.
const DEEP = role('r-deep', 'deep', null, ['view-audit']);

const certain = { kind: 'certain', lost: ['view-audit'] } as const;

const refusal = (status: number, detail?: string, type = 'about:blank') =>
  ({ ok: false, kind: 'problem', problem: { type, title: 'Refused', status, detail } }) as const;

describe('the ceiling on a role, by what the server says it reaches', () => {
  it('holds a delete back when what the role reaches is beyond the caller', () => {
    expect(deleteBlock(DEEP, ['manage-tenant'])).toBe(
      'deep reaches view-audit, which you do not hold, so you cannot delete it.',
    );
    expect(deleteBlock(AUDITOR, ['manage-tenant'])).toBeNull();
  });

  it('holds a default back while the role reaches an admin capability, however deep', () => {
    expect(defaultBlock(DEEP)).toBe(
      'It reaches view-audit, and a role every new subject receives may reach no admin capability. Take those composites out of it first.',
    );
    expect(defaultBlock(AUDITOR)).toBeNull();
    expect(defaultBlock({ ...DEEP, default_for_new_subjects: true })).toBeNull();
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
    expect(childUnavailable(AUDITOR, DEEP, [], ['manage-users'], 'acme')).toBe(
      'It reaches view-audit, which you do not hold, so you cannot give or take it.',
    );
    expect(
      childUnavailable(
        { ...AUDITOR, default_for_new_subjects: true },
        DEEP,
        [],
        ['view-audit'],
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

describe('the ceiling of a role record', () => {
  const authority = { capabilities: ['view-users'] as AdminCapability[], crossTenant: false };
  it('checks until whoami and the record are read', () => {
    expect(roleCeiling(undefined, authority)).toEqual({ status: 'checking' });
    expect(roleCeiling(READER, undefined)).toEqual({ status: 'checking' });
  });

  it('holds a deletion by what the role reaches, never for the built-in client', () => {
    expect(roleCeiling(READER, authority)).toEqual({
      status: 'ready',
      caller: ['view-users'],
      deleteHeld: null,
    });
    expect(roleCeiling(DEEP, authority)).toMatchObject({
      deleteHeld: 'deep reaches view-audit, which you do not hold, so you cannot delete it.',
    });
    expect(roleCeiling(FULL, authority)).toMatchObject({ deleteHeld: null });
    expect(isDeleteHeld(roleCeiling(DEEP, authority))).toBe(true);
    expect(isDeleteHeld(roleCeiling(READER, authority))).toBe(false);
    expect(isDeleteHeld({ status: 'checking' })).toBe(false);
  });

  it('checks the defaults until read, except for a built-in role that has none to check', () => {
    expect(defaultsChecking(READER, { status: 'checking' })).toBe(true);
    expect(defaultsChecking(USERS, { status: 'checking' })).toBe(false);
    expect(defaultsChecking(READER, roleCeiling(READER, authority))).toBe(false);
  });
});

describe('the composites a role offers', () => {
  it('waits for the ceiling and for the principal own roles', () => {
    const ready = { status: 'ready', caller: [], deleteHeld: null } as const;
    expect(compositesOffered(ready, { status: 'ready' })).toBe(true);
    expect(compositesOffered(ready, { status: 'unknown' })).toBe(true);
    expect(compositesOffered(ready, { status: 'loading' })).toBe(false);
    expect(compositesOffered({ status: 'checking' }, { status: 'ready' })).toBe(false);
  });

  it('says what taking one out comes to', () => {
    expect(compositeRemovalConfirmation('reader', 'auditor', certain)).toEqual({
      title: 'Take out a role your own access runs through?',
      consequence:
        'Whoever holds reader no longer holds auditor through it. You hold view-audit through auditor nested in reader, so this takes it from you, and this console with it.',
    });
    expect(unnestedText('auditor', 'reader')).toBe('auditor is no longer nested in reader.');
  });

  it('words a failed removal by what happened to the edge', () => {
    expect(compositeRemovalFailureText('reader', 'auditor', refusal(412))).toBe(
      "reader's composites changed since you opened them, so auditor was not taken out. They have been read again; look before trying again.",
    );
    expect(
      compositeRemovalFailureText(
        'reader',
        'auditor',
        refusal(409, 'would create a role composite cycle'),
      ),
    ).toBe('Refused: auditor already includes this role, so nesting it here would make a loop.');
    expect(compositeRemovalFailureText('reader', 'auditor', refusal(500, 'boom'))).toBe(
      'auditor was not taken out: boom',
    );
    for (const kind of ['network', 'schema', 'defect'] as const) {
      expect(compositeRemovalFailureText('reader', 'auditor', { ok: false, kind })).toBe(
        'Could not confirm whether auditor was taken out. Look at the list before trying again.',
      );
    }
  });
});
