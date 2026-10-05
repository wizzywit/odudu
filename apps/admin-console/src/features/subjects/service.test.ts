import { USERNAME_RULE } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import {
  ADDRESS_CLAIMS,
  credentialsOf,
  DETAIL_CLAIMS,
  lockoutSummary,
  NAME_CLAIMS,
  newSubjectHref,
  accessRefusal,
  removalConfirmation,
  actionsRecord,
  groupsRecord,
  heldLines,
  mailRefusal,
  profileRecord,
  REQUIRED_ACTIONS,
  rolesRecord,
  splitRoles,
  takesTenants,
  SUBJECT_TAB_LABELS,
  SUBJECT_TABS,
  subjectTabHref,
  subjectHref,
  subjectRecord,
  TAB_RECORDS,
  subjectName,
  subjectsHref,
  subjectsTrail,
  USERNAME_RULE_TEXT,
  usernameProblem,
} from '#/features/subjects/service.ts';

describe('addresses', () => {
  it('puts a subject under its tenant, each part escaped', () => {
    expect(subjectsHref('acme')).toBe('/console/acme/subjects');
    expect(newSubjectHref('acme')).toBe('/console/acme/subjects/new');
    expect(subjectHref('acme', 'a b')).toBe('/console/acme/subjects/a%20b');
  });
});

describe('the way back to the list', () => {
  it('climbs through the Identity group to the tenant’s subjects', () => {
    expect(subjectsTrail('a b', 'grace')).toEqual([
      { label: 'Identity' },
      { label: 'Subjects', href: '/console/a%20b/subjects' },
      { label: 'grace' },
    ]);
  });
});

describe('the username', () => {
  it("states the contract's own rule, as a sentence", () => {
    expect(USERNAME_RULE_TEXT.toLowerCase()).toBe(`${USERNAME_RULE}.`.toLowerCase());
    expect(USERNAME_RULE_TEXT.startsWith('A username')).toBe(true);
  });

  it('asks for one before sending anything', () => {
    expect(usernameProblem('')).toBe('Enter a username.');
    expect(usernameProblem('ada')).toBeNull();
  });

  it('names a subject by its username, or by its kind and id when it has none', () => {
    expect(subjectName({ id: 's1', type: 'user', username: 'ada' })).toBe('ada');
    expect(subjectName({ id: 's2', type: 'service', username: null })).toBe('service s2');
  });
});

describe('the claims', () => {
  it('names every claim the profile carries exactly once', () => {
    const names = [...NAME_CLAIMS, ...DETAIL_CLAIMS, ...ADDRESS_CLAIMS].map((claim) => claim.id);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toHaveLength(20);
  });

  it('gives each claim the input its shape needs, and its autocomplete token', () => {
    const inputs = Object.fromEntries(
      [...NAME_CLAIMS, ...DETAIL_CLAIMS, ...ADDRESS_CLAIMS].map((c) => [
        c.id,
        `${c.input}:${c.autoComplete ?? '-'}`,
      ]),
    );
    expect(inputs).toEqual({
      name: 'text:name',
      given_name: 'text:given-name',
      family_name: 'text:family-name',
      middle_name: 'text:additional-name',
      nickname: 'text:nickname',
      preferred_username: 'text:username',
      phone_number: 'phone:-',
      profile: 'url:url',
      picture: 'picture:photo',
      website: 'url:url',
      gender: 'gender:-',
      birthdate: 'birthdate:-',
      zoneinfo: 'zone:-',
      locale: 'locale:-',
      address_formatted: 'text:-',
      address_street: 'text:street-address',
      address_locality: 'text:address-level2',
      address_region: 'text:address-level1',
      address_postal_code: 'text:postal-code',
      address_country: 'country:-',
    });
  });

  it('runs a compound field and the address lines wider than one column', () => {
    const spans = Object.fromEntries(
      [...NAME_CLAIMS, ...DETAIL_CLAIMS, ...ADDRESS_CLAIMS]
        .filter((c) => c.span !== undefined)
        .map((c) => [c.id, c.span]),
    );
    expect(spans).toEqual({
      phone_number: 'wide',
      address_formatted: 'full',
      address_street: 'wide',
    });
  });

  // Three columns of three rows with no hole: phone and gender, the three
  // web addresses, then birthdate, zone and locale.
  it('orders the details so each row of three columns fills', () => {
    expect(DETAIL_CLAIMS.map((c) => c.id)).toEqual([
      'phone_number',
      'gender',
      'profile',
      'website',
      'picture',
      'birthdate',
      'zoneinfo',
      'locale',
    ]);
  });
});

describe('credentials', () => {
  it('splits a list into the password, the second factors and the recovery-code count', () => {
    const split = credentialsOf([
      { id: 'p', type: 'password', created_at: '2026-01-01T00:00:00.000Z', expired: false },
      { id: 't', type: 'totp', created_at: '2026-01-02T00:00:00.000Z' },
      { id: 'w', type: 'webauthn', created_at: '2026-01-03T00:00:00.000Z' },
      { type: 'recovery-code', created_at: '2026-01-04T00:00:00.000Z', recovery_code_count: 7 },
    ]);
    expect(split.password?.id).toBe('p');
    expect(split.factors.map((factor) => factor.id)).toEqual(['t', 'w']);
    expect(split.recoveryCodes).toBe(7);
  });

  it('holds no password, no factors and no codes for an empty list', () => {
    expect(credentialsOf([])).toEqual({ password: null, factors: [], recoveryCodes: null });
  });
});

describe('the lockout', () => {
  it('says a subject with nothing on record has no failed sign-ins', () => {
    expect(
      lockoutSummary({
        locked: false,
        locked_until: null,
        failure_count: 0,
        last_failure_at: null,
      }),
    ).toEqual({ tone: 'neutral', state: 'not locked', text: 'No failed sign-ins on record.' });
  });

  it('says how many failures a subject that is not locked has on record', () => {
    expect(
      lockoutSummary({
        locked: false,
        locked_until: null,
        failure_count: 1,
        last_failure_at: '2026-09-29T09:58:00.000Z',
      }),
    ).toMatchObject({ tone: 'neutral', state: 'not locked', text: /^1 failed sign-in on record/u });
  });

  it('says a locked subject is locked, and after how many failures', () => {
    expect(
      lockoutSummary({
        locked: true,
        locked_until: '2026-09-29T10:02:00.000Z',
        failure_count: 6,
        last_failure_at: '2026-09-29T09:59:00.000Z',
      }),
    ).toMatchObject({ tone: 'danger', state: 'locked', text: /after 6 failed sign-ins/u });
  });
});

describe('the record tabs', () => {
  it('names, for every tab, the records whose sections it edits', () => {
    expect(Object.keys(TAB_RECORDS).sort()).toEqual([...SUBJECT_TABS].sort());
    expect(TAB_RECORDS.profile('s1')).toEqual([subjectRecord('s1'), profileRecord('s1')]);
    expect(TAB_RECORDS.credentials('s1')).toEqual([]);
    expect(TAB_RECORDS.groups('s1')).toEqual([groupsRecord('s1')]);
    expect(TAB_RECORDS.roles('s1')).toEqual([rolesRecord('s1')]);
    expect(TAB_RECORDS['required-actions']('s1')).toEqual([actionsRecord('s1')]);
    expect(TAB_RECORDS.sessions('s1')).toEqual([]);
  });

  it('runs in the order the record page shows them', () => {
    expect(SUBJECT_TABS.map((tab) => SUBJECT_TAB_LABELS[tab])).toEqual([
      'Profile',
      'Credentials',
      'Groups',
      'Roles',
      'Required actions',
      'Sessions',
      'Consents',
      'Grants',
      'Activity',
    ]);
  });

  it('addresses one tab of a record', () => {
    expect(subjectTabHref('acme', 's 1', 'roles')).toBe('/console/acme/subjects/s%201?tab=roles');
  });
});

describe('required actions', () => {
  it('words each action the way the mailed link does', () => {
    expect(REQUIRED_ACTIONS.map((action) => action.label)).toEqual([
      'Choose a new password',
      'Set up an authenticator app',
      'Register a passkey',
      'Generate recovery codes',
    ]);
  });
});

describe('roles', () => {
  const assigned = (id: string, name: string, key: string | null) => ({
    id,
    name,
    client_id: key === null ? null : `c-${key}`,
    client_key: key,
  });

  it('tells the admin capabilities apart from every other role', () => {
    expect(
      splitRoles([
        assigned('r1', 'billing', null),
        assigned('r2', 'manage-users', 'odudu-admin'),
        assigned('r3', 'tenant-admin', 'odudu-admin'),
        assigned('r4', 'tenant-admin', null),
      ]),
    ).toEqual({
      roleIds: ['r1', 'r4'],
      adminIds: ['r2', 'r3'],
      holdings: ['tenant-admin', 'manage-users'],
    });
  });
});

describe('a holder in a list of administrators', () => {
  it('says what is held and whether directly, leaving out what another holding carries', () => {
    expect(
      heldLines([
        { name: 'tenant-admin', direct: true },
        { name: 'manage-users', direct: false },
        { name: 'view-users', direct: false },
      ]),
    ).toEqual([{ holding: 'tenant-admin', label: 'Full (tenant-admin)', how: 'directly' }]);
    expect(
      heldLines([
        { name: 'manage-users', direct: true },
        { name: 'view-users', direct: false },
        { name: 'view-audit', direct: false },
      ]),
    ).toEqual([
      { holding: 'manage-users', label: 'manage-users', how: 'directly' },
      { holding: 'view-audit', label: 'view-audit', how: 'through a group or role' },
    ]);
  });
});

describe('a mail the server would not send', () => {
  it('explains each refusal in words, naming where it is fixed', () => {
    expect(mailRefusal('about:blank#no-email', 'ada')).toEqual({
      text: 'ada has no email address. Add one under Profile first.',
      fix: 'profile',
    });
    expect(mailRefusal('about:blank#no-mail-relay', 'ada')?.fix).toBe('email');
    expect(mailRefusal('about:blank#reset-password-off', 'ada')?.fix).toBe('settings');
    expect(mailRefusal('about:blank', 'ada')).toBeNull();
  });
});

describe('a change to what a subject holds, refused', () => {
  const problem = (status: number, type = 'about:blank') => ({ type, title: 'x', status });

  it('says the ceiling a 403 met, in the words of what was changed', () => {
    expect(accessRefusal('ada', 'groups')(problem(403))).toMatch(
      /a group's roles are granted with it/u,
    );
    expect(accessRefusal('ada', 'roles')(problem(403))).toMatch(/only what you hold yourself/u);
  });

  it('words the last-administrator guard in place', () => {
    expect(accessRefusal('ada', 'roles')(problem(409, 'about:blank#last-administrator'))).toBe(
      'ada is the last enabled administrator here, and this would take that away, so nothing was changed. Make somebody else an administrator first.',
    );
    expect(accessRefusal('ada', 'roles')(problem(409))).toBeNull();
  });
});

describe('the last-administrator guard, worded in place', () => {
  it("keeps the API's detail, and says so of yourself", () => {
    const problem = {
      type: 'about:blank#last-administrator',
      status: 409,
      detail: 'this would leave no enabled subject holding tenant-admin',
    };
    expect(accessRefusal('ada', 'roles', true)(problem)).toBe(
      'You are the last enabled administrator here, and this would take that away, so nothing was changed (this would leave no enabled subject holding tenant-admin). Make somebody else an administrator first.',
    );
  });
});

describe('what is asked before a save takes capabilities away', () => {
  it('asks nothing of a change to somebody else that leaves every tenant alone', () => {
    expect(
      removalConfirmation({
        name: 'ada',
        self: false,
        removed: ['view-audit'],
        removesTenants: false,
      }),
    ).toBeNull();
    expect(
      removalConfirmation({ name: 'ada', self: true, removed: [], removesTenants: false }),
    ).toBeNull();
  });

  it('says what this console stops offering when you take from yourself', () => {
    expect(
      removalConfirmation({
        name: 'ada',
        self: true,
        removed: ['view-audit'],
        removesTenants: false,
      }),
    ).toEqual({
      title: 'Remove your own admin capabilities?',
      consequence:
        'You are taking view-audit from yourself. Once it lands this console stops offering reading the audit trail, unless a group or another role still gives it to you, and you cannot give it back yourself.',
      typed: null,
    });
  });

  it('asks for the name, typed, before manage-tenants is taken from anybody', () => {
    const asked = removalConfirmation({
      name: 'ada',
      self: false,
      removed: ['tenant-admin'],
      removesTenants: true,
    });
    expect(asked?.title).toBe('Take system administration from ada?');
    expect(asked?.typed).toBe('ada');
    expect(
      removalConfirmation({
        name: 'ada',
        self: true,
        removed: ['manage-tenants'],
        removesTenants: true,
      })?.title,
    ).toBe('Revoke your own system administration?');
  });
});

describe('whether leaving groups takes manage-tenants', () => {
  const full = (via: unknown[]) => ({
    id: 'r-full',
    name: 'tenant-admin',
    client_id: 'c',
    client_key: 'odudu-admin',
    via: via as never,
  });
  const byGroup = full([{ kind: 'group', group_id: 'g', group_path: '/admins' }]);

  it('does when the last group beneath the mapped one is left', () => {
    expect(takesTenants([byGroup], ['/admins/oncall'], [])).toBe(true);
  });

  it('does not while another group beneath it remains, or Full is held otherwise', () => {
    expect(takesTenants([byGroup], ['/admins/oncall', '/admins'], ['/admins'])).toBe(false);
    expect(
      takesTenants(
        [full([{ kind: 'direct' }, { kind: 'group', group_id: 'g', group_path: '/admins' }])],
        ['/admins'],
        [],
      ),
    ).toBe(false);
    expect(takesTenants([byGroup], ['/ops'], [])).toBe(false);
  });
});
