import { describe, expect, it } from 'vitest';
import { ADMIN_CLIENT_KEY, grantableIn } from '#/shared/services/capabilities/holdings';
import {
  holdingNote,
  holdingOptions,
  beyondCaller,
  roleReachUnavailable,
  ceilingOf,
  heldCapabilities,
  provenanceListText,
  provenanceText,
  roleOwnerText,
  blockedByDefault,
} from '#/shared/services/capabilities/held';
import { effectiveRole } from '#/testing/roleAnswers';

describe('heldCapabilities', () => {
  it('says how each admin capability is held, and leaves other roles out', () => {
    const held = heldCapabilities([
      effectiveRole('tenant-admin', [{ kind: 'direct' }]),
      effectiveRole('manage-users', [
        { kind: 'composite', parent_role_id: 'r-tenant-admin', parent_name: 'tenant-admin' },
        { kind: 'group', group_id: 'g1', group_path: '/ops' },
      ]),
      effectiveRole('billing', [{ kind: 'direct' }], null),
    ]);
    expect(held.get('tenant-admin')).toEqual({ direct: true, through: [] });
    expect(held.get('manage-users')).toEqual({
      direct: false,
      through: ['within tenant-admin', 'through group /ops'],
    });
    expect([...held.keys()]).toEqual(['tenant-admin', 'manage-users']);
  });
});

describe('provenanceListText', () => {
  it('says every way a role is held, in order', () => {
    expect(
      provenanceListText([{ kind: 'direct' }, { kind: 'group', group_id: 'g', group_path: '/a' }]),
    ).toBe('directly, through group /a');
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

describe('roleReachUnavailable', () => {
  const plain = { name: 'auditor', client_key: null, admin_reach: [] };

  it('lets a role that reaches nothing be given or taken', () => {
    expect(roleReachUnavailable(plain, [], 'acme')).toBeNull();
  });

  it('refuses a role that reaches what the caller does not hold', () => {
    expect(
      roleReachUnavailable({ ...plain, admin_reach: ['manage-keys'] }, ['view-users'], 'acme'),
    ).toBe('It reaches manage-keys, which you do not hold, so you cannot give or take it.');
  });

  it('judges a capability of the admin client by the capability itself', () => {
    const capability = { name: 'manage-keys', client_key: ADMIN_CLIENT_KEY, admin_reach: [] };
    expect(roleReachUnavailable(capability, ['manage-keys'], 'acme')).toBeNull();
    expect(roleReachUnavailable(capability, ['view-users'], 'acme')).toBe(
      'You do not hold manage-keys, so you cannot give or take it.',
    );
  });
});

describe('blockedByDefault', () => {
  it('names the reach a default may not carry, and nothing for what is no default', () => {
    expect(blockedByDefault(true, ['view-users', 'manage-users'])).toEqual([
      'view-users',
      'manage-users',
    ]);
    expect(blockedByDefault(true, [])).toEqual([]);
    expect(blockedByDefault(false, ['view-users'])).toEqual([]);
  });
});
