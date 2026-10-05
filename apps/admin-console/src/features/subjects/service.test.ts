import { USERNAME_RULE } from '@odudu/contracts/admin';
import { describe, expect, it } from 'vitest';
import { createFailure } from '#/shared/service/failure.ts';
import type { GatewayFailure } from '#/shared/service/result.ts';
import type { Holding } from '#/shared/service/capabilities.ts';
import {
  actionsMailProblem,
  assignmentsOf,
  adminRolesBlocked,
  capabilitiesRemoveTenants,
  capabilityOptions,
  changeFailureText,
  claimFields,
  credentialChangeOf,
  credentialDialog,
  credentialDoneText,
  credentialFailureText,
  createSubjectHref,
  describeActions,
  describeHoldings,
  enabledVerb,
  grantClients,
  grantsRevokedText,
  groupsRemoveTenants,
  heldElsewhere,
  keptOtherwise,
  knownAssignments,
  leaveConfirmation,
  leftGroups,
  mailFieldErrors,
  mailOutcome,
  mailSentText,
  membersListHref,
  membershipsOf,
  newSubjectSpec,
  onlyHolder,
  ownRolesOf,
  PROFILE_SECTIONS,
  reachOf,
  reachesEveryTenant,
  canManageSubject,
  recoveryCodesText,
  requiredActionsInOrder,
  roleIdsOf,
  roleOwnerOf,
  roleUnavailableHere,
  consentRevokedText,
  sessionEndedText,
  sessionsEndedText,
  subjectBeyond,
  subjectCreatedText,
  subjectWriteFailure,
  usernameMode,
  beyondText,
  elsewhereText,
  holderFilterOptions,
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

const failure = (kind: 'network' | 'schema' | 'defect'): GatewayFailure => ({ ok: false, kind });
const refusal = (
  status: number,
  extra: { type?: string; detail?: string; errors?: { path: string; message: string }[] } = {},
): GatewayFailure => ({
  ok: false,
  kind: 'problem',
  problem: { type: 'about:blank', title: `T${String(status)}`, status, ...extra },
});

describe('creating a subject', () => {
  it('says where the password comes from', () => {
    expect(subjectCreatedText('ada')).toBe(
      'ada was created. It has no password yet: issue a one-time password from its Credentials tab.',
    );
  });

  it('words a refusal and an unreadable answer its own way, and places a rejected field', () => {
    const spec = newSubjectSpec('ada');
    expect(createFailure(refusal(403), spec)).toMatchObject({
      report: true,
      message: 'ada was not created: it needs the manage-users capability.',
    });
    expect(createFailure(failure('schema'), spec)).toMatchObject({
      unconfirmed: true,
      message: 'ada may have been created, but the answer could not be read. Look for it.',
    });
    expect(createFailure(failure('network'), spec).message).toBe(
      'Could not confirm whether ada was created. It has not been sent again; look for it before trying again.',
    );
    expect(createFailure(failure('defect'), spec).message).toBe(
      'The console could not create the subject. This is a fault in the console, not something you did.',
    );
    const rejected = refusal(400, { errors: [{ path: 'email', message: 'invalid' }] });
    expect(createFailure(rejected, spec)).toMatchObject({
      errors: { email: 'invalid' },
      report: false,
    });
    expect(createFailure(refusal(409, { detail: 'taken' }), spec).report).toBe(false);
  });

  it('offers creating only while nothing rules it out', () => {
    expect(createSubjectHref('acme', [])).toBe('/console/acme/subjects/new');
    expect(createSubjectHref('acme', ['manage-users'])).toBeNull();
  });

  it('links the subjects of a group or a role to the list filtered by it', () => {
    expect(membersListHref('acme', 'group', 'g 1')).toBe('/console/acme/subjects?group=g+1');
    expect(membersListHref('acme', 'role', 'r1')).toBe('/console/acme/subjects?role=r1');
  });
});

describe('the roles the caller holds', () => {
  const roles = {
    status: 'ready',
    data: { items: [{ id: 'r' }] },
    retry: () => undefined,
  } as never;
  const groups = {
    status: 'ready',
    data: { items: [{ path: '/a' }] },
    retry: () => undefined,
  } as never;
  const loading = { status: 'loading' } as const;
  const failed = { status: 'failed', retry: () => undefined } as const;
  const authority = { capabilities: ['view-users'] } as never;

  it('holds nothing here when signed in to another tenant', () => {
    expect(
      ownRolesOf({ member: false, authority: undefined, roles: loading, groups: loading }),
    ).toEqual({
      status: 'ready',
      roles: [],
      groups: [],
    });
  });

  it('waits for whoami, and cannot read without view-users', () => {
    expect(ownRolesOf({ member: true, authority: undefined, roles, groups })).toEqual({
      status: 'loading',
    });
    expect(
      ownRolesOf({ member: true, authority: { capabilities: [] } as never, roles, groups }),
    ).toEqual({ status: 'unknown' });
  });

  it('is unknown once either read failed, loading while either is, and ready with both', () => {
    expect(ownRolesOf({ member: true, authority, roles: failed, groups: loading })).toEqual({
      status: 'unknown',
    });
    expect(ownRolesOf({ member: true, authority, roles, groups: loading })).toEqual({
      status: 'loading',
    });
    expect(ownRolesOf({ member: true, authority, roles, groups })).toEqual({
      status: 'ready',
      roles: [{ id: 'r' }],
      groups: ['/a'],
    });
  });
});

describe('what a confirmed change says when it fails', () => {
  it('words each way a change can end, and a missing subject as already gone', () => {
    expect(changeFailureText(failure('network'), 'manage-users')).toBe(
      'Could not confirm the result. Nothing was sent again; the tab shows what the server holds now.',
    );
    expect(changeFailureText(failure('schema'), 'manage-users')).toBe(
      'It may have happened, but the answer could not be read. The tab shows what the server holds now.',
    );
    expect(changeFailureText(failure('defect'), 'manage-users')).toBe(
      'The console could not finish. This is a fault in the console, not something you did.',
    );
    expect(changeFailureText(refusal(403), 'manage-sessions')).toBe(
      'Refused: it needs the manage-sessions capability, or the subject holds an admin capability you do not.',
    );
    expect(changeFailureText(refusal(404), 'manage-users')).toBe('It is already gone.');
    expect(changeFailureText(refusal(500, { detail: 'boom' }), 'manage-users')).toBe(
      'Refused: boom',
    );
    expect(changeFailureText(refusal(500), 'manage-users')).toBe('Refused: T500');
  });
});

describe('what a failed change to the account says', () => {
  it('names the subject and the verb, and keeps the server’s word for the rest', () => {
    expect(subjectWriteFailure(failure('network'), 'ada', 'deleted')).toBe(
      'Could not confirm whether ada was deleted. It has not been sent again; look at the subject before trying again.',
    );
    expect(subjectWriteFailure(failure('schema'), 'ada', 'enabled')).toBe(
      'ada may have been enabled, but the answer could not be read. Reload to check.',
    );
    expect(subjectWriteFailure(failure('defect'), 'ada', 'disabled')).toBe(
      'The console could not finish, so ada was not disabled. This is a fault in the console, not something you did.',
    );
    expect(subjectWriteFailure(refusal(403), 'ada', 'deleted')).toBe(
      'ada was not deleted: it needs the manage-users capability, or ada holds an admin capability you do not.',
    );
    expect(subjectWriteFailure(refusal(412), 'ada', 'enabled')).toBe(
      'ada changed elsewhere since you opened it, so it was not enabled. It has been read again; look at it before trying again.',
    );
    expect(subjectWriteFailure(refusal(409, { detail: 'last one' }), 'ada', 'deleted')).toBe(
      'ada was not deleted: last one',
    );
  });

  it('says enabled or disabled for what was asked', () => {
    expect(enabledVerb(true)).toBe('enabled');
    expect(enabledVerb(false)).toBe('disabled');
  });
});

describe('the username in the account section', () => {
  const retry = () => undefined;
  it('waits for the policy, and offers a retry when it could not be read', () => {
    expect(usernameMode({ status: 'loading' }, '/s')).toEqual({ kind: 'checking' });
    expect(usernameMode({ status: 'failed', retry }, '/s')).toEqual({ kind: 'failed', retry });
  });

  it('offers a rename where the policy allows it, and otherwise says why not', () => {
    expect(usernameMode({ status: 'ready', editable: true }, '/s')).toEqual({
      kind: 'editable',
      description: USERNAME_RULE_TEXT,
    });
    expect(usernameMode({ status: 'ready', editable: false }, '/s')).toMatchObject({
      kind: 'fixed',
      settingsHref: '/s',
      reason: expect.stringMatching(/username_editable setting is off/u) as string,
    });
  });
});

describe('credential changes', () => {
  const factor = {
    kind: 'factor',
    credential: { id: 'c1', type: 'totp', created_at: 'x' },
  } as const;

  it('maps what was asked to the change that is sent, none for a factor without an id', () => {
    expect(credentialChangeOf(factor)).toEqual({ kind: 'factor', credentialId: 'c1' });
    expect(
      credentialChangeOf({ kind: 'factor', credential: { type: 'totp', created_at: 'x' } }),
    ).toBeNull();
    expect(credentialChangeOf({ kind: 'recovery-codes' })).toEqual({ kind: 'recovery-codes' });
    expect(credentialChangeOf({ kind: 'lockout' })).toEqual({ kind: 'lockout' });
  });

  it('says what was done, by name', () => {
    expect(credentialDoneText('ada', factor)).toBe('Authenticator app (TOTP) removed from ada.');
    expect(credentialDoneText('ada', { kind: 'recovery-codes' })).toBe(
      "ada's recovery codes are revoked.",
    );
    expect(credentialDoneText('ada', { kind: 'lockout' })).toBe("ada's lockout is cleared.");
  });

  it('says what a failure was, with what it concerned', () => {
    expect(credentialFailureText('The password', failure('network'))).toBe(
      'Could not confirm the result. The password has not been sent again; the tab shows what the server holds now.',
    );
    expect(credentialFailureText('The change', failure('schema'))).toBe(
      'The change may have happened, but the answer could not be read. The tab shows what the server holds now.',
    );
    expect(credentialFailureText('The change', failure('defect'))).toBe(
      'The console could not finish. This is a fault in the console, not something you did.',
    );
    expect(credentialFailureText('The change', refusal(403))).toBe(
      'Refused: it needs the manage-users capability, or the subject holds an admin capability you do not.',
    );
    expect(credentialFailureText('The change', refusal(500, { detail: 'boom' }))).toBe(
      'Refused: boom',
    );
  });

  it('asks for each change in its own words, and for your own password differently', () => {
    expect(credentialDialog({ kind: 'password' }, 'ada', false)).toMatchObject({
      title: 'Issue ada a one-time password?',
      confirmLabel: 'Issue password',
      tone: 'primary',
      consequence: expect.stringMatching(/^This replaces the password ada has/u) as string,
    });
    expect(credentialDialog({ kind: 'password' }, 'ada', true).consequence).toMatch(
      /^This replaces your own password/u,
    );
    expect(credentialDialog(factor, 'ada', false)).toMatchObject({
      title: 'Remove ada’s authenticator app (TOTP)?',
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    expect(credentialDialog({ kind: 'recovery-codes' }, 'ada', false)).toMatchObject({
      title: 'Revoke ada’s recovery codes?',
      confirmLabel: 'Revoke recovery codes',
      tone: 'danger',
    });
    expect(credentialDialog({ kind: 'lockout' }, 'ada', false)).toMatchObject({
      title: 'Clear ada’s lockout?',
      confirmLabel: 'Clear lockout',
      tone: 'primary',
    });
  });

  it('counts the codes that are left', () => {
    expect(recoveryCodesText('ada', null)).toBe('No recovery codes: ada holds no unspent one.');
    expect(recoveryCodesText('ada', 0)).toBe('No recovery codes: ada holds no unspent one.');
    expect(recoveryCodesText('ada', 1)).toBe('1 unspent recovery code');
    expect(recoveryCodesText('ada', 8)).toBe('8 unspent recovery codes');
  });
});

describe('required actions', () => {
  it('keeps the order the next sign-in asks for them', () => {
    expect(requiredActionsInOrder(['configure-totp', 'update-password', 'nonsense'])).toEqual([
      'update-password',
      'configure-totp',
    ]);
  });

  it('names those chosen in that order, or none', () => {
    expect(describeActions(['configure-totp', 'update-password'])).toBe(
      'Choose a new password, Set up an authenticator app',
    );
    expect(describeActions([])).toBe('none');
    expect(describeActions('x')).toBe('none');
  });
});

describe('group memberships', () => {
  const known = new Map([['g1', { path: '/a', description: 'A' }]]);

  it('names each by its path and description, or by its id until it is known', () => {
    expect(membershipsOf(['g1', 'g2'], known)).toEqual([
      { id: 'g1', path: '/a', description: 'A' },
      { id: 'g2', path: 'g2', description: null },
    ]);
  });

  it('lists the paths of the groups that were held and are no longer chosen', () => {
    const held = [
      { id: 'g1', path: '/a' },
      { id: 'g2', path: '/b' },
    ];
    expect(leftGroups(held, ['g2'])).toEqual(['/a']);
    expect(leftGroups(held, ['g1', 'g2'])).toEqual([]);
  });

  it('asks before you leave groups of your own, and nobody else', () => {
    expect(leaveConfirmation(false, ['/a'])).toBeNull();
    expect(leaveConfirmation(true, [])).toBeNull();
    expect(leaveConfirmation(true, ['/a', '/b'])).toMatchObject({
      title: 'Leave groups of your own?',
      typed: null,
      consequence: expect.stringMatching(
        /^You are leaving \/a, \/b\. Every role a group carries/u,
      ) as string,
    });
  });

  it('takes manage-tenants only in system, once the roles are read', () => {
    const effective = {
      status: 'ready',
      retry: () => undefined,
      data: {
        items: [
          {
            id: 'r',
            name: 'tenant-admin',
            client_id: 'c',
            client_key: 'odudu-admin',
            via: [{ kind: 'group', group_id: 'g', group_path: '/admins' }],
          },
        ],
      },
    } as never;
    expect(groupsRemoveTenants('system', effective, ['/admins'], [])).toBe(true);
    expect(groupsRemoveTenants('acme', effective, ['/admins'], [])).toBe(false);
    expect(groupsRemoveTenants('system', { status: 'loading' }, ['/admins'], [])).toBe(false);
  });
});

describe('role assignments', () => {
  it('is known by name and client from the held list and the picker alike', () => {
    const known = knownAssignments(
      [{ id: 'r1', name: 'editor', client_key: null }],
      [{ id: 'r2', name: 'reader', client_key: 'web' }],
    );
    expect(assignmentsOf(['r1', 'r2', 'r3'], known)).toEqual([
      { id: 'r1', name: 'editor', client: null },
      { id: 'r2', name: 'reader', client: 'web' },
      { id: 'r3', name: 'r3', client: null },
    ]);
  });

  it('keeps an admin capability out of the plain role picker, and says where it is set', () => {
    expect(roleUnavailableHere({ name: 'manage-keys', client_key: 'odudu-admin' })).toBe(
      'an admin capability: set it under Admin capabilities',
    );
    expect(roleUnavailableHere({ name: 'editor', client_key: null })).toBeNull();
  });

  it('says whose a directly held role is', () => {
    expect(roleOwnerOf(null)).toBe('tenant role');
    expect(roleOwnerOf('web')).toBe('client web');
  });
});

describe('profile sections', () => {
  it('splits the claims into name, details and address', () => {
    expect(PROFILE_SECTIONS.map((section) => [section.id, section.title])).toEqual([
      ['name', 'Name'],
      ['details', 'Details'],
      ['address', 'Address'],
    ]);
  });

  it('holds each claim as text, the ones the subject lacks as empty', () => {
    const fields = claimFields({ name: 'Ada' } as never, NAME_CLAIMS.slice(0, 2));
    expect(fields).toEqual({
      name: { value: 'Ada', label: 'Full name', kind: 'plain' },
      given_name: { value: '', label: 'Given name', kind: 'plain' },
    });
  });
});

describe('mail outcomes', () => {
  const hrefs = { profile: '/p', email: '/e', settings: '/s' };

  it('says a lost answer, an unreadable one and a console fault, none with a fix', () => {
    expect(mailOutcome(failure('network'), 'ada', hrefs)).toMatchObject({ sent: false, fix: null });
    expect(mailOutcome(failure('schema'), 'ada', hrefs)).toEqual({
      sent: true,
      text: 'The mail was asked for, but the answer could not be read.',
      fix: null,
    });
    expect(mailOutcome(failure('defect'), 'ada', hrefs).text).toBe(
      'The console could not finish. This is a fault in the console, not something you did.',
    );
  });

  it('points a refusal that is a fact about the tenant or subject at where it is put right', () => {
    expect(mailOutcome(refusal(409, { type: 'about:blank#no-email' }), 'ada', hrefs)).toEqual({
      sent: false,
      text: 'ada has no email address. Add one under Profile first.',
      fix: { label: 'Profile', href: '/p' },
    });
    expect(
      mailOutcome(refusal(409, { type: 'about:blank#no-mail-relay' }), 'ada', hrefs).fix,
    ).toEqual({
      label: 'Email',
      href: '/e',
    });
    expect(
      mailOutcome(refusal(409, { type: 'about:blank#reset-password-off' }), 'ada', hrefs).fix,
    ).toEqual({
      label: 'Settings',
      href: '/s',
    });
  });

  it('words any other refusal without a fix', () => {
    expect(mailOutcome(refusal(403), 'ada', hrefs).text).toBe(
      'Refused: it needs the manage-users capability, or ada holds an admin capability you do not.',
    );
    expect(mailOutcome(refusal(500, { detail: 'boom' }), 'ada', hrefs)).toEqual({
      sent: false,
      text: 'Not sent: boom',
      fix: null,
    });
    expect(mailOutcome(refusal(500), 'ada', hrefs).text).toBe('Not sent: T500');
  });

  it('places a 400 under the actions field for the actions mail only', () => {
    const rejected = refusal(400, { errors: [{ path: 'actions', message: 'none' }] });
    expect(mailFieldErrors('actions', rejected)).toEqual({
      fields: { actions: 'none' },
      other: [],
    });
    expect(mailFieldErrors('reset', rejected)).toBeNull();
    expect(mailFieldErrors('actions', refusal(403))).toBeNull();
    expect(mailFieldErrors('actions', failure('network'))).toBeNull();
  });

  it('says what was sent, and to whom', () => {
    expect(mailSentText('reset', 'a@x.test')).toBe('A password reset link was sent to a@x.test.');
    expect(mailSentText('verification', null)).toBe(
      'A verification link was sent to their address.',
    );
    expect(mailSentText('actions', 'a@x.test', 1)).toBe(
      'A link through 1 action was sent to a@x.test. Following it asks for each, in order.',
    );
    expect(mailSentText('actions', 'a@x.test', 3)).toMatch(/^A link through 3 actions was sent/u);
  });

  it('wants at least one action for the actions mail', () => {
    expect(actionsMailProblem([])).toEqual({ actions: 'Choose at least one action.' });
    expect(actionsMailProblem(['update-password'])).toBeNull();
  });
});

describe('the toasts and groupings of sessions and grants', () => {
  it('says what ended or was revoked, counted', () => {
    expect(sessionEndedText('ada')).toBe('The session of ada ended.');
    expect(sessionsEndedText('ada', 1)).toBe('1 session of ada ended.');
    expect(sessionsEndedText('ada', 3)).toBe('3 sessions of ada ended.');
    expect(consentRevokedText('ada', 'web')).toBe("ada's consent to web revoked.");
    expect(grantsRevokedText('ada', 1, 'web')).toBe('1 grant of ada through web revoked.');
    expect(grantsRevokedText('ada', 2, 'web')).toBe('2 grants of ada through web revoked.');
  });

  it('lists each client a grant was issued through once, in the order first met', () => {
    expect(
      grantClients([
        { client_id: 'c1', client_key: 'web' },
        { client_id: 'c2', client_key: 'app' },
        { client_id: 'c1', client_key: 'web' },
      ] as never),
    ).toEqual([
      { id: 'c1', key: 'web' },
      { id: 'c2', key: 'app' },
    ]);
  });
});

describe('what a subject holds beyond the caller', () => {
  const effective = (names: string[]) =>
    ({
      status: 'ready',
      retry: () => undefined,
      data: {
        items: names.map((name) => ({
          id: name,
          name,
          client_id: 'c',
          client_key: 'odudu-admin',
          via: [{ kind: 'direct' }],
        })),
      },
    }) as never;

  it('is what the subject holds and the caller does not, nothing until both are known', () => {
    expect(subjectBeyond(effective(['manage-keys', 'view-audit']), ['view-audit'])).toEqual([
      'manage-keys',
    ]);
    expect(subjectBeyond(effective(['manage-keys']), undefined)).toEqual([]);
    expect(subjectBeyond({ status: 'loading' }, ['view-audit'])).toEqual([]);
  });

  it('is changeable once whoami allows it, the reach is read and nothing is beyond', () => {
    expect(canManageSubject([], 'ready', [])).toBe(true);
    expect(canManageSubject(['manage-users'], 'ready', [])).toBe(false);
    expect(canManageSubject([], 'loading', [])).toBe(false);
    expect(canManageSubject([], 'ready', ['manage-keys'])).toBe(false);
  });

  it('says whether the reach is being checked, read, or could not be', () => {
    const retry = () => undefined;
    expect(reachOf({ status: 'loading' })).toBe('checking');
    expect(reachOf(effective([]))).toBe('ready');
    expect(reachOf({ status: 'failed', retry })).toEqual({ failed: true, retry });
  });

  it('tells the reader what is beyond them, for changing or for viewing', () => {
    expect(beyondText('ada', ['manage-keys', 'view-audit'], 'change')).toBe(
      'ada holds manage-keys and view-audit, which you do not, so you cannot change what ada holds.',
    );
    expect(beyondText('ada', ['manage-keys'], 'view')).toBe(
      'ada holds manage-keys, which you do not, so you can view ada but change nothing here.',
    );
  });
});

describe('the admin capabilities a subject is given', () => {
  const held = new Map([
    ['view-audit' as const, { direct: true, through: [] }],
    ['manage-keys' as const, { direct: false, through: ['through group /ops'] }],
  ]);

  it('names a role id for each holding, or the holdings that have none', () => {
    const roles = new Map([['view-audit' as const, 'r1']]);
    expect(roleIdsOf(['view-audit'], roles)).toEqual({ ids: ['r1'] });
    expect(roleIdsOf(['view-audit', 'manage-keys'], roles)).toEqual({ missing: ['manage-keys'] });
    expect(roleIdsOf([], null)).toEqual({ missing: [] });
  });

  it('counts a capability as kept when a group or another role gives it', () => {
    expect(
      keptOtherwise(
        new Map([['tenant-admin' as const, { direct: true, through: [] }]]),
        'tenant-admin',
      ),
    ).toBe(false);
    expect(
      keptOtherwise(
        new Map([['tenant-admin' as const, { direct: true, through: ['within tenant-admin'] }]]),
        'tenant-admin',
      ),
    ).toBe(false);
    expect(
      keptOtherwise(
        new Map([['tenant-admin' as const, { direct: false, through: ['through group /a'] }]]),
        'tenant-admin',
      ),
    ).toBe(true);
    expect(
      keptOtherwise(
        new Map([['tenant-admin' as const, { direct: false, through: ['through group /a'] }]]),
        'manage-tenants',
      ),
    ).toBe(true);
  });

  it('takes manage-tenants away only in system, when none of what carries it is kept', () => {
    const take = (tenant: string, base: Holding[], chosen: string[], kept: boolean) =>
      capabilitiesRemoveTenants(tenant, base, chosen, kept);
    expect(take('system', ['tenant-admin'], [], false)).toBe(true);
    expect(take('system', ['manage-tenants'], ['view-audit'], false)).toBe(true);
    expect(take('system', ['tenant-admin'], ['manage-tenants'], false)).toBe(false);
    expect(take('system', ['tenant-admin'], [], true)).toBe(false);
    expect(take('acme', ['tenant-admin'], [], false)).toBe(false);
    expect(take('system', ['view-audit'], [], false)).toBe(false);
  });

  it('guards the one holding that would leave the tenant without an enabled holder', () => {
    const count = (n: number, capped = false) =>
      ({
        status: 'ready',
        retry: () => undefined,
        data: { count: n, capped },
      }) as never;
    const base = {
      enabled: true,
      held: new Map([['tenant-admin' as const, { direct: true, through: [] }]]),
      counted: 'tenant-admin' as const,
      holders: count(1),
      keptOtherwise: false,
      chosen: ['tenant-admin'] as Holding[],
    };
    expect(onlyHolder(base)).toBe('tenant-admin');
    expect(onlyHolder({ ...base, enabled: false })).toBeNull();
    expect(onlyHolder({ ...base, holders: count(2) })).toBeNull();
    expect(onlyHolder({ ...base, holders: count(1, true) })).toBeNull();
    expect(onlyHolder({ ...base, holders: { status: 'loading' } })).toBeNull();
    expect(onlyHolder({ ...base, keptOtherwise: true })).toBeNull();
    expect(onlyHolder({ ...base, held: new Map() })).toBeNull();
    const both = new Map([
      ['tenant-admin' as const, { direct: true, through: [] }],
      ['manage-tenants' as const, { direct: true, through: [] }],
    ]);
    expect(
      onlyHolder({
        ...base,
        held: both,
        counted: 'manage-tenants',
        chosen: ['tenant-admin', 'manage-tenants'],
      }),
    ).toBeNull();
    expect(
      onlyHolder({ ...base, held: both, counted: 'manage-tenants', chosen: ['manage-tenants'] }),
    ).toBe('manage-tenants');
  });

  it('offers every holding, guarding the one that is the last', () => {
    const options = capabilityOptions({
      tenant: 'acme',
      name: 'ada',
      chosen: [],
      caller: ['view-audit'],
      held,
      guarded: 'view-audit',
      counted: 'tenant-admin',
    });
    expect(options.find((option) => option.id === 'view-audit')?.unavailable).toBe(
      'ada is the only enabled holder of tenant-admin, so acme would be left with nobody holding it. Give it to somebody else first.',
    );
    expect(options.find((option) => option.id === 'manage-keys')).toMatchObject({
      unavailable: 'You do not hold manage-keys, so you cannot give or take it.',
      note: 'Held through group /ops.',
    });
  });

  it('names what is held only through a group or role, and by which', () => {
    expect(heldElsewhere(held, [])).toEqual([
      { label: 'manage-keys', through: 'through group /ops' },
    ]);
    expect(heldElsewhere(held, ['tenant-admin'])).toEqual([]);
  });

  it('describes the holdings it chose, or none', () => {
    expect(describeHoldings(['view-audit', 'tenant-admin', 'nonsense'])).toBe(
      'view-audit, Full (tenant-admin)',
    );
    expect(describeHoldings([])).toBe('none');
    expect(describeHoldings(3)).toBe('none');
  });

  it('says why nothing can be saved until the admin roles are read', () => {
    expect(adminRolesBlocked('loading', 'x')).toBe('The admin roles are still being read.');
    expect(adminRolesBlocked('failed', 'x')).toBe(
      'The admin roles could not be read, so nothing can be saved.',
    );
    expect(adminRolesBlocked('ready', 'x')).toBe('x');
    expect(adminRolesBlocked('ready', undefined)).toBeUndefined();
  });

  it('says what is held through a group or role, and that only it takes it away', () => {
    expect(
      elsewhereText('ada', [
        { label: 'A', through: 'through g' },
        { label: 'B', through: 'within A' },
      ]),
    ).toBe('A through g and B within A: only that group or role takes it away, on ada’s ');
  });
});

describe('holders of admin capabilities', () => {
  it('reaches every tenant from system by manage-tenants or Full, and from nowhere else', () => {
    const held = (name: string) => [{ name, direct: true }] as never;
    expect(reachesEveryTenant('system', held('manage-tenants'))).toBe(true);
    expect(reachesEveryTenant('system', held('tenant-admin'))).toBe(true);
    expect(reachesEveryTenant('system', held('view-audit'))).toBe(false);
    expect(reachesEveryTenant('acme', held('manage-tenants'))).toBe(false);
  });

  it('filters by any capability, Full, or each one the tenant offers', () => {
    const options = holderFilterOptions('acme');
    expect(options.slice(0, 2)).toEqual([
      { id: 'any', label: 'Any capability' },
      { id: 'tenant-admin', label: 'Full (tenant-admin)' },
    ]);
    expect(options.some((option) => option.id === 'manage-tenants')).toBe(false);
    expect(holderFilterOptions('system').some((option) => option.id === 'manage-tenants')).toBe(
      true,
    );
  });
});
