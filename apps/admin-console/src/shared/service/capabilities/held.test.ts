import type { EffectiveRoleAssignment } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import { ADMIN_CLIENT_KEY, grantableIn } from '#/shared/service/capabilities/holdings.ts';
import {
  holdingNote,
  holdingOptions,
  beyondCaller,
  ceilingOf,
  heldCapabilities,
  provenanceText,
  roleOwnerText,
} from '#/shared/service/capabilities/held.ts';

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

describe('roleOwnerText', () => {
  it('says whose a role is in words', () => {
    expect(roleOwnerText({ client_id: null, client_key: null })).toBe('tenant role');
    expect(roleOwnerText({ client_id: 'c', client_key: 'portal' })).toBe('role of client portal');
    expect(roleOwnerText({ client_id: 'c', client_key: ADMIN_CLIENT_KEY })).toBe(
      'admin capability',
    );
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
