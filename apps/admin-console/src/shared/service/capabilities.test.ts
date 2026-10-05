import type { EffectiveRoleAssignment } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import {
  ADMIN_CLIENT_KEY,
  asksFirst,
  holdingNote,
  holdingOptions,
  lossBlocked,
  beyondCaller,
  ceilingOf,
  grantableIn,
  adminClientOfRoles,
  heldCapabilities,
  holdingRoleIds,
  includedBy,
  isAdminRole,
  provenanceText,
  adminLoss,
  roleOwnerText,
  writeRefusal,
} from '#/shared/service/capabilities.ts';

function role(
  name: string,
  via: EffectiveRoleAssignment['via'],
  clientKey: string | null = ADMIN_CLIENT_KEY,
): EffectiveRoleAssignment {
  return {
    id: `r-${name}`,
    name,
    client_id: clientKey === null ? null : 'c-admin',
    client_key: clientKey,
    via,
  };
}

describe('grantableIn', () => {
  it('offers manage-tenants in system alone', () => {
    expect(grantableIn('acme')).not.toContain('manage-tenants');
    expect(grantableIn('system')).toContain('manage-tenants');
    expect(grantableIn('acme')).toContain('view-audit');
  });
});

describe('isAdminRole', () => {
  it("is a capability or tenant-admin of the built-in admin client, not a tenant role's namesake", () => {
    expect(isAdminRole({ name: 'manage-users', client_key: ADMIN_CLIENT_KEY })).toBe(true);
    expect(isAdminRole({ name: 'tenant-admin', client_key: ADMIN_CLIENT_KEY })).toBe(true);
    expect(isAdminRole({ name: 'tenant-admin', client_key: null })).toBe(false);
    expect(isAdminRole({ name: 'billing', client_key: ADMIN_CLIENT_KEY })).toBe(false);
    expect(isAdminRole({ name: 'manage-users', client_key: 'odudu-admin-x' })).toBe(false);
  });
});

describe('heldCapabilities', () => {
  it('says how each admin capability is held, and leaves other roles out', () => {
    const held = heldCapabilities([
      role('tenant-admin', [{ kind: 'direct' }]),
      role('manage-users', [
        { kind: 'composite', parent_role_id: 'r-tenant-admin', parent_name: 'tenant-admin' },
        { kind: 'group', group_id: 'g1', group_path: '/ops' },
      ]),
      role('billing', [{ kind: 'direct' }], null),
    ]);
    expect(held.get('tenant-admin')).toEqual({ direct: true, through: [] });
    expect(held.get('manage-users')).toEqual({
      direct: false,
      through: ['within tenant-admin', 'through group /ops'],
    });
    expect([...held.keys()]).toEqual(['tenant-admin', 'manage-users']);
  });
});

describe('provenanceText', () => {
  it('names each path', () => {
    expect(provenanceText({ kind: 'direct' })).toBe('directly');
    expect(provenanceText({ kind: 'group', group_id: 'g', group_path: '/a/b' })).toBe(
      'through group /a/b',
    );
    expect(
      provenanceText({ kind: 'composite', parent_role_id: 'r', parent_name: 'auditors' }),
    ).toBe('within auditors');
  });
});

describe('ceilingOf', () => {
  it('refuses to give or take what the caller does not hold', () => {
    expect(ceilingOf('acme', 'manage-keys', ['manage-users', 'view-users'])).toBe(
      'You do not hold manage-keys, so you cannot give or take it.',
    );
    expect(ceilingOf('acme', 'manage-users', ['manage-users'])).toBeNull();
  });

  it('asks every capability Full carries for Full itself', () => {
    expect(ceilingOf('acme', 'tenant-admin', ['manage-users', 'view-users'])).toBe(
      'Full carries capabilities you do not hold, so you cannot give or take it.',
    );
    expect(ceilingOf('acme', 'tenant-admin', grantableIn('acme'))).toBeNull();
    expect(ceilingOf('system', 'tenant-admin', grantableIn('acme'))).not.toBeNull();
  });
});

describe('beyondCaller', () => {
  it('lists what the subject holds that the caller does not', () => {
    expect(beyondCaller(['view-users', 'manage-keys'], ['view-users', 'manage-users'])).toEqual([
      'manage-keys',
    ]);
    expect(beyondCaller(['tenant-admin', 'view-users'], ['view-users'])).toEqual([]);
  });
});

describe('includedBy', () => {
  it('says which chosen capability already carries another', () => {
    expect(includedBy('manage-keys', ['tenant-admin'])).toBe('tenant-admin');
    expect(includedBy('view-users', ['manage-users'])).toBe('manage-users');
    expect(includedBy('view-audit', ['manage-users'])).toBeNull();
    expect(includedBy('tenant-admin', ['tenant-admin'])).toBeNull();
  });
});

describe('roleOwnerText', () => {
  it('says whose a role is in words', () => {
    expect(roleOwnerText({ client_id: null, client_key: null })).toBe('tenant role');
    expect(roleOwnerText({ client_id: 'c', client_key: 'portal' })).toBe('role of client portal');
    expect(roleOwnerText({ client_id: 'c', client_key: ADMIN_CLIENT_KEY })).toBe(
      'admin capability',
    );
  });
});

describe('writeRefusal', () => {
  const refused = (status: number, detail?: string, type = 'about:blank') => ({
    type,
    status,
    title: 'Refused',
    ...(detail === undefined ? {} : { detail }),
  });

  it('says what a ceiling refusal would have handed out and taken away', () => {
    expect(
      writeRefusal(
        refused(
          403,
          'the caller does not hold: manage-users; this removes capabilities the caller does not hold: view-audit',
        ),
      ),
    ).toBe(
      'Refused: it would hand out manage-users and take view-audit from whoever holds it through here, none of which you hold yourself.',
    );
    expect(writeRefusal(refused(403, 'the caller does not hold: manage-keys'))).toBe(
      'Refused: it would hand out manage-keys, which you do not hold yourself.',
    );
  });

  it("keeps the server's own reason for any other refusal, and names the guard", () => {
    expect(
      writeRefusal(
        refused(
          403,
          'a group every new subject joins may reach no admin capability, and this one would reach: view-users',
        ),
      ),
    ).toBe(
      'Refused: a group every new subject joins may reach no admin capability, and this one would reach: view-users.',
    );
    expect(writeRefusal(refused(403))).toBe(
      'Refused: it needs the manage-tenant capability, or reaches a capability you do not hold.',
    );
    expect(writeRefusal(refused(409, 'ada is the last', 'about:blank#last-administrator'))).toBe(
      'Refused: it would leave this tenant with no enabled administrator (ada is the last). Make somebody else an administrator first.',
    );
    expect(writeRefusal(refused(409, 'would create a group reparent cycle'))).toBeNull();
    expect(writeRefusal(refused(400, 'x'))).toBeNull();
  });
});

describe('adminLoss', () => {
  const group = (path: string) => ({
    kind: 'group' as const,
    group_id: `g${path}`,
    group_path: path,
  });
  const within = (parent: string) => ({
    kind: 'composite' as const,
    parent_role_id: `r-${parent}`,
    parent_name: parent,
  });

  it('names what goes once every way it is held goes, nested capabilities with it', () => {
    const own = [
      role('tenant-admin', [group('/admins')]),
      role('manage-users', [within('tenant-admin')]),
      role('view-users', [within('manage-users'), { kind: 'direct' }]),
      role('auditor', [group('/admins')], null),
    ];
    expect(adminLoss(own, (via) => via.kind === 'group' && via.group_path === '/admins')).toEqual([
      'tenant-admin',
      'manage-users',
    ]);
  });

  it('keeps what is held another way too', () => {
    const own = [role('view-audit', [group('/admins'), group('/ops')])];
    expect(adminLoss(own, (via) => via.kind === 'group' && via.group_path === '/admins')).toEqual(
      [],
    );
  });
});

describe('asksFirst and lossBlocked', () => {
  it('asks before a loss that is certain or possible, and waits while it is checked', () => {
    expect(asksFirst({ kind: 'certain', lost: ['a'] })).toBe(true);
    expect(asksFirst({ kind: 'possible', lost: ['a'] })).toBe(true);
    expect(asksFirst({ kind: 'none' })).toBe(false);
    expect(asksFirst({ kind: 'checking' })).toBe(false);
    expect(lossBlocked({ kind: 'checking' })).toBe('Checking what this takes from you first.');
    expect(lossBlocked({ kind: 'none' })).toBeUndefined();
    expect(lossBlocked({ kind: 'certain', lost: ['a'] })).toBeUndefined();
  });
});

describe('holdingNote', () => {
  it('names a carrier first, else how it is held elsewhere, else nothing', () => {
    expect(holdingNote('tenant-admin', undefined)).toBe('Carried by Full (tenant-admin).');
    expect(holdingNote(null, { direct: false, through: ['through group eng', 'within X'] })).toBe(
      'Held through group eng, within X.',
    );
    expect(holdingNote(null, { direct: true, through: ['within X'] })).toBe('Also held within X.');
    expect(holdingNote(null, { direct: true, through: [] })).toBeNull();
    expect(holdingNote(null, undefined)).toBeNull();
  });
});

describe('holdingOptions', () => {
  it('lists Full then each capability the tenant offers, with its text', () => {
    const options = holdingOptions('acme', [], undefined);
    expect(options[0]).toMatchObject({
      id: 'tenant-admin',
      label: 'Full (tenant-admin)',
      description: 'Every capability this tenant offers.',
      note: null,
      unavailable: null,
    });
    expect(options.map((option) => option.id)).toEqual(['tenant-admin', ...grantableIn('acme')]);
    expect(holdingOptions('system', [], undefined)[0]?.description).toMatch(/manage-tenants/u);
  });

  it('notes what already carries one, and rules out what the caller could not give', () => {
    const options = holdingOptions('acme', ['tenant-admin'], ['view-users']);
    const viewUsers = options.find((option) => option.id === 'view-users');
    expect(viewUsers?.note).toBe('Carried by Full (tenant-admin).');
    expect(viewUsers?.unavailable).toBeNull();
    expect(options[0]?.unavailable).toMatch(/^Full carries capabilities you do not hold/u);
    expect(options.find((option) => option.id === 'manage-keys')?.unavailable).toMatch(
      /do not hold manage-keys/u,
    );
  });

  it('shows how a holding is held, and lets a guard rule it out when the ceiling does not', () => {
    const held = new Map([
      ['view-audit' as const, { direct: false, through: ['through group g'] }],
    ]);
    const options = holdingOptions('acme', [], ['view-audit'], {
      held,
      guard: (holding) => (holding === 'view-audit' ? 'The last one.' : null),
    });
    const audit = options.find((option) => option.id === 'view-audit');
    expect(audit?.note).toBe('Held through group g.');
    expect(audit?.unavailable).toBe('The last one.');
    const beforeWhoami = holdingOptions('acme', [], undefined, { guard: () => 'Guarded.' });
    expect(beforeWhoami[0]?.unavailable).toBe('Guarded.');
  });
});

describe('the built-in admin client in a role list', () => {
  const roles = [
    { id: 'r1', name: 'tenant-admin', client_id: 'c-own', client_key: 'own' },
    { id: 'r2', name: 'tenant-admin', client_id: 'c-admin', client_key: ADMIN_CLIENT_KEY },
    { id: 'r3', name: 'manage-keys', client_id: 'c-admin', client_key: ADMIN_CLIENT_KEY },
    { id: 'r4', name: 'manage-keys', client_id: 'c-own', client_key: 'own' },
    { id: 'r5', name: 'editor', client_id: 'c-admin', client_key: ADMIN_CLIENT_KEY },
    { id: 'r6', name: 'view-audit', client_id: null, client_key: null },
  ];

  it('is found through its own tenant-admin, not a tenant role of the same name', () => {
    expect(adminClientOfRoles(roles)).toBe('c-admin');
    expect(adminClientOfRoles(roles.slice(0, 1))).toBeNull();
    expect(adminClientOfRoles([{ ...roles[1]!, client_id: null }])).toBeNull();
  });

  it('names a role id for each capability it holds, and no other role', () => {
    expect([...holdingRoleIds(roles)]).toEqual([
      ['tenant-admin', 'r2'],
      ['manage-keys', 'r3'],
    ]);
  });
});
