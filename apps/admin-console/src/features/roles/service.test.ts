import type { EffectiveRoleAssignment } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import type { AdminCapability } from '#/shared/service/principal.ts';
import {
  addRefusal,
  type CopyRead,
  compositeRemovalConfirmation,
  compositeRemovalFailureText,
  compositesFixed,
  compositesOffered,
  copiedDescription,
  copyHrefOf,
  copyingOf,
  copyingText,
  copyPlan,
  defaultsChecking,
  deletionFixed,
  isDeleteHeld,
  partialCopy,
  roleCeiling,
  roleDeleteConsequence,
  roleDeleteFailureText,
  unnestedText,
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
    expect(deleteBlock(USERS, [])).toBe(
      'manage-users is a capability of the built-in admin client, so it cannot be deleted: every administrator holding it would lose it.',
    );
    expect(defaultBlock(USERS)).toBe(
      'A capability of the built-in admin client is never handed to every new subject.',
    );
  });
});

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

const certain = { kind: 'certain', lost: ['view-audit'] } as const;
const refusal = (status: number, detail?: string, type = 'about:blank') =>
  ({ ok: false, kind: 'problem', problem: { type, title: 'Refused', status, detail } }) as const;

describe('copying a role', () => {
  it('nests each child the caller could nest, and says why it leaves the rest', () => {
    const plan = copyPlan([AUDITOR, USERS], ['view-users'], 'acme');
    expect(plan.nested).toEqual([AUDITOR]);
    expect(plan.left).toEqual([
      {
        name: 'manage-users',
        why: 'You do not hold manage-users, so you cannot give or take it.',
      },
    ]);
  });

  it('nests everything until the caller is known', () => {
    expect(copyPlan([AUDITOR, USERS], undefined, 'acme')).toEqual({
      nested: [AUDITOR, USERS],
      left: [],
    });
  });

  it('shows the description edited, else the source one', () => {
    const source: CopyRead = {
      status: 'ready',
      role: { ...AUDITOR, description: 'Reads' },
      children: [],
    };
    expect(copiedDescription('mine', source)).toBe('mine');
    expect(copiedDescription('', source)).toBe('');
    expect(copiedDescription(null, source)).toBe('Reads');
    expect(copiedDescription(null, { status: 'ready', role: AUDITOR, children: [] })).toBe('');
    expect(copiedDescription(null, { status: 'loading' })).toBe('');
  });

  it('maps the source read to what the page shows', () => {
    const plan = { nested: [AUDITOR], left: [{ name: 'x', why: 'y' }] };
    expect(copyingOf({ status: 'none' }, plan)).toEqual({ status: 'none' });
    expect(copyingOf({ status: 'loading' }, plan)).toEqual({ status: 'loading' });
    expect(copyingOf({ status: 'failed' }, plan)).toEqual({ status: 'failed' });
    expect(copyingOf({ status: 'ready', role: READER, children: [] }, plan)).toEqual({
      status: 'ready',
      name: 'reader',
      children: ['auditor'],
      left: [{ name: 'x', why: 'y' }],
    });
  });

  it('says what a copy nests', () => {
    expect(copyingText({ name: 'reader', children: [] })).toBe(
      'A copy of reader, nesting nothing.',
    );
    expect(copyingText({ name: 'reader', children: ['a', 'b', 'c'] })).toBe(
      'A copy of reader, nesting a, b and c.',
    );
  });

  it('keeps a copy missing composites on the page, pointing at where to add them', () => {
    expect(partialCopy('acme', READER, [])).toBeNull();
    expect(partialCopy('acme', READER, [AUDITOR, USERS])).toEqual({
      text: 'reader was created, but auditor and manage-users could not be nested in it. Add them from its Composites tab.',
      href: '/console/acme/roles/r-read?tab=composites',
      name: 'reader',
    });
  });

  it('offers a copy only of a tenant role', () => {
    expect(copyHrefOf('acme', READER)).toBe('/console/acme/roles/new?copy=r-read');
    expect(copyHrefOf('acme', USERS)).toBeNull();
    expect(copyHrefOf('acme', undefined)).toBeNull();
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

describe('the built-in sentences', () => {
  it('say what a capability role keeps, and that it is never deleted', () => {
    expect(compositesFixed(READER)).toBeNull();
    expect(compositesFixed(USERS)).toBe(
      'manage-users is a capability of the built-in admin client: it keeps the roles it was provisioned with, and nothing is nested in it or taken out of it here.',
    );
    expect(deletionFixed(READER)).toBeNull();
    expect(deletionFixed(USERS)).toBe(
      'manage-users is a capability of the built-in admin client, so it cannot be deleted: every administrator holding it would lose it.',
    );
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

describe('deleting a role', () => {
  it('says what it comes to, with the loss appended', () => {
    expect(roleDeleteConsequence('reader', { kind: 'none' })).toBe(
      'reader is taken from every subject, group and scope it is given to, and out of every role it is nested in; what it nests is no longer held through it. It cannot be undone.',
    );
    expect(roleDeleteConsequence('reader', certain)).toContain(
      ' You hold view-audit through reader, so this takes it from you',
    );
  });

  it('words a failed delete, the server own reason for a refusal first', () => {
    expect(roleDeleteFailureText('reader', refusal(409, 'still in use'))).toBe(
      'Refused: still in use.',
    );
    expect(roleDeleteFailureText('reader', refusal(500, 'boom'))).toBe(
      'reader was not deleted: boom',
    );
    expect(roleDeleteFailureText('reader', refusal(403, 'x'))).toBe('Refused: x.');
    expect(roleDeleteFailureText('reader', { ok: false, kind: 'network' })).toBe(
      'Could not confirm whether reader was deleted. It has not been sent again; look at the roles before trying again.',
    );
  });
});

describe('adding a composite', () => {
  it('names the role chosen in a refusal, and leaves other refusals to the shared wording', () => {
    expect(
      addRefusal({
        type: 'about:blank',
        status: 409,
        detail: 'would create a role composite cycle',
      }),
    ).toBe(
      'Refused: the role chosen already includes this role, so nesting it here would make a loop.',
    );
    expect(addRefusal({ type: 'about:blank', status: 500 })).toBeNull();
  });
});
