import {
  USERNAME_RULE,
  type Credential,
  type EffectiveRoleAssignment,
  type HeldAdminCapability,
  type Lockout,
  type Profile,
  type RequiredAction,
  type Subject,
} from '@odudu/contracts/admin';
import { holds, notLacking } from '#/shared/service/access.ts';
import {
  administratorCapability,
  MANAGE_TENANTS,
  TENANT_ADMIN,
} from '#/shared/service/administrators.ts';
import type { Crumb } from '#/shared/service/breadcrumb.ts';
import {
  beyondCaller,
  heldCapabilities,
  holdingLabel,
  holdingOptions,
  holdingsIn,
  grantableIn,
  includedBy,
  isAdminRole,
  isHolding,
  type Held,
  type Holding,
  type HoldingOption,
} from '#/shared/service/capabilities.ts';
import { createdText, writeFailureText, type CreateSpec } from '#/shared/service/failure.ts';
import { fieldErrorsOf, type FieldErrors } from '#/shared/service/fieldErrors.ts';
import { andList, counted, flagText, formatAbsolute } from '#/shared/service/format.ts';
import { inOrderOf } from '#/shared/service/ids.ts';
import { SYSTEM_TENANT, type AdminCapability, type Authority } from '#/shared/service/principal.ts';
import type { GatewayFailure } from '#/shared/service/result.ts';
import type { SectionFields } from '#/shared/service/sectionSave.ts';

export type { Credential, Lockout, Profile, Subject };

export function subjectsHref(tenant: string): string {
  return `/console/${encodeURIComponent(tenant)}/subjects`;
}

export function newSubjectHref(tenant: string): string {
  return `${subjectsHref(tenant)}/new`;
}

export function subjectHref(tenant: string, id: string): string {
  return `${subjectsHref(tenant)}/${encodeURIComponent(id)}`;
}

// The rail group is a heading, not a page, so it has no address.
export function subjectsTrail(tenant: string, current: string): readonly Crumb[] {
  return [
    { label: 'Identity' },
    { label: 'Subjects', href: subjectsHref(tenant) },
    { label: current },
  ];
}

export function subjectName(subject: Pick<Subject, 'id' | 'type' | 'username'>): string {
  return subject.username ?? `${subject.type} ${subject.id}`;
}

export const USERNAME_RULE_TEXT = `${USERNAME_RULE.charAt(0).toUpperCase()}${USERNAME_RULE.slice(1)}.`;

export function usernameProblem(username: string): string | null {
  return username === '' ? 'Enter a username.' : null;
}

type Claim = keyof Omit<Profile, 'email_verified' | 'phone_number_verified' | 'profile_updated_at'>;

// Which typed field a claim is edited with, by the shape OIDC Core §5.1
// gives it.
export type ClaimInput =
  'text' | 'url' | 'picture' | 'phone' | 'birthdate' | 'gender' | 'zone' | 'locale' | 'country';

export interface ClaimField {
  id: Claim;
  label: string;
  input: ClaimInput;
  // The HTML token naming what a text claim holds (WCAG 1.3.5); a typed
  // field carries its own.
  autoComplete?: string;
  // How far the field runs across the profile's columns, where one is narrow.
  span?: 'wide' | 'full';
}

export const NAME_CLAIMS: readonly ClaimField[] = [
  { id: 'name', label: 'Full name', input: 'text', autoComplete: 'name' },
  { id: 'given_name', label: 'Given name', input: 'text', autoComplete: 'given-name' },
  { id: 'family_name', label: 'Family name', input: 'text', autoComplete: 'family-name' },
  { id: 'middle_name', label: 'Middle name', input: 'text', autoComplete: 'additional-name' },
  { id: 'nickname', label: 'Nickname', input: 'text', autoComplete: 'nickname' },
  {
    id: 'preferred_username',
    label: 'Preferred username',
    input: 'text',
    autoComplete: 'username',
  },
];

export const DETAIL_CLAIMS: readonly ClaimField[] = [
  { id: 'phone_number', label: 'Phone number', input: 'phone', span: 'wide' },
  { id: 'gender', label: 'Gender', input: 'gender' },
  { id: 'profile', label: 'Profile page', input: 'url', autoComplete: 'url' },
  { id: 'website', label: 'Website', input: 'url', autoComplete: 'url' },
  { id: 'picture', label: 'Picture', input: 'picture', autoComplete: 'photo' },
  { id: 'birthdate', label: 'Birthdate', input: 'birthdate' },
  { id: 'zoneinfo', label: 'Time zone', input: 'zone' },
  { id: 'locale', label: 'Locale', input: 'locale' },
];

// The formatted address is the whole address as one text; HTML names no
// autofill purpose for that.
export const ADDRESS_CLAIMS: readonly ClaimField[] = [
  { id: 'address_formatted', label: 'Formatted address', input: 'text', span: 'full' },
  {
    id: 'address_street',
    label: 'Street',
    input: 'text',
    autoComplete: 'street-address',
    span: 'wide',
  },
  { id: 'address_locality', label: 'Locality', input: 'text', autoComplete: 'address-level2' },
  { id: 'address_region', label: 'Region', input: 'text', autoComplete: 'address-level1' },
  { id: 'address_postal_code', label: 'Postal code', input: 'text', autoComplete: 'postal-code' },
  { id: 'address_country', label: 'Country', input: 'country' },
];

export interface Credentials {
  password: Credential | null;
  // A TOTP enrolment or a passkey, each removable on its own.
  factors: readonly Credential[];
  // Unspent codes, or null when none was ever issued.
  recoveryCodes: number | null;
}

export function credentialsOf(items: readonly Credential[]): Credentials {
  const codes = items.find((item) => item.type === 'recovery-code');
  return {
    password: items.find((item) => item.type === 'password') ?? null,
    factors: items.filter((item) => item.type === 'totp' || item.type === 'webauthn'),
    recoveryCodes: codes === undefined ? null : (codes.recovery_code_count ?? 0),
  };
}

export function factorLabel(type: Credential['type']): string {
  return type === 'totp' ? 'Authenticator app (TOTP)' : 'Passkey';
}

// Two passkeys share a label, so each Remove names when its own was enrolled.
export function removeFactorLabel(credential: Credential): string {
  return `Remove ${factorLabel(credential.type)} enrolled ${formatAbsolute(new Date(credential.created_at))}`;
}

export interface LockoutSummary {
  tone: 'neutral' | 'danger';
  state: 'locked' | 'not locked';
  text: string;
}

function failures(count: number): string {
  return count === 1 ? '1 failed sign-in' : `${String(count)} failed sign-ins`;
}

// `locked` is the server's judgement, so a clock skewed here cannot say
// otherwise; the times are shown beside this text, not in it.
export function lockoutSummary(lockout: Lockout): LockoutSummary {
  if (lockout.locked) {
    return {
      tone: 'danger',
      state: 'locked',
      text: `Locked after ${failures(lockout.failure_count)} in a row. Every sign-in is refused, the right password too, until the lock lifts or is cleared.`,
    };
  }
  if (lockout.failure_count === 0) {
    return { tone: 'neutral', state: 'not locked', text: 'No failed sign-ins on record.' };
  }
  return {
    tone: 'neutral',
    state: 'not locked',
    text: `${failures(lockout.failure_count)} on record. The next failure counts on from them, until a quiet spell or the right password ends the run.`,
  };
}

// A subject's record, a tab per concern, in the order the page shows them.
export const SUBJECT_TABS = [
  'profile',
  'credentials',
  'groups',
  'roles',
  'required-actions',
  'sessions',
  'consents',
  'grants',
  'activity',
] as const;
export type SubjectTab = (typeof SUBJECT_TABS)[number];

export const SUBJECT_TAB_LABELS: Readonly<Record<SubjectTab, string>> = {
  profile: 'Profile',
  credentials: 'Credentials',
  groups: 'Groups',
  roles: 'Roles',
  'required-actions': 'Required actions',
  sessions: 'Sessions',
  consents: 'Consents',
  grants: 'Grants',
  activity: 'Activity',
};

export function subjectTabHref(tenant: string, id: string, tab: SubjectTab): string {
  return `${subjectHref(tenant, id)}?tab=${tab}`;
}

export function subjectRecord(id: string): string {
  return `subjects/${id}`;
}

export function profileRecord(id: string): string {
  return `subjects/${id}/profile`;
}

export function groupsRecord(id: string): string {
  return `subjects/${id}/groups`;
}

export function rolesRecord(id: string): string {
  return `subjects/${id}/roles`;
}

export function actionsRecord(id: string): string {
  return `subjects/${id}/required-actions`;
}

// The records whose sections each tab edits, so its dot follows them.
export const TAB_RECORDS: Readonly<Record<SubjectTab, (id: string) => readonly string[]>> = {
  profile: (id) => [subjectRecord(id), profileRecord(id)],
  credentials: () => [],
  groups: (id) => [groupsRecord(id)],
  roles: (id) => [rolesRecord(id)],
  'required-actions': (id) => [actionsRecord(id)],
  sessions: () => [],
  consents: () => [],
  grants: () => [],
  activity: () => [],
};

// In the order the next sign-in asks for them.
export const REQUIRED_ACTIONS: readonly {
  action: RequiredAction;
  label: string;
  description: string;
}[] = [
  {
    action: 'update-password',
    label: 'Choose a new password',
    description: 'The next sign-in asks for a new password before it lets them in.',
  },
  {
    action: 'configure-totp',
    label: 'Set up an authenticator app',
    description: 'Enrols a TOTP authenticator, which then becomes a second factor.',
  },
  {
    action: 'configure-passkey',
    label: 'Register a passkey',
    description: 'Registers a passkey on the device they sign in from.',
  },
  {
    action: 'generate-recovery-codes',
    label: 'Generate recovery codes',
    description: 'Shows them a fresh set of recovery codes, once, replacing any they hold.',
  },
];

interface Assigned {
  id: string;
  name: string;
  client_key: string | null;
}

export interface SplitRoles {
  roleIds: string[];
  adminIds: string[];
  // The admin capabilities assigned, Full first, in the order they are offered.
  holdings: Holding[];
}

// One assignment list holds both: the admin capabilities are edited on their
// own, and every save sends the other part back as it was.
export function splitRoles(items: readonly Assigned[]): SplitRoles {
  const admin = items.filter((role) => isAdminRole(role));
  const holdings = admin.map((role) => role.name).filter((name) => isHolding(name));
  return {
    roleIds: items.filter((role) => !isAdminRole(role)).map((role) => role.id),
    adminIds: admin.map((role) => role.id),
    holdings: [
      ...holdings.filter((name) => name === 'tenant-admin'),
      ...holdings.filter((name) => name !== 'tenant-admin'),
    ],
  };
}

export interface HeldLine {
  holding: string;
  label: string;
  how: string;
}

// What a listed holder holds: Full collapses what it carries, and
// manage-users view-users; which group or role carries the rest is the
// open editor's to say.
export function heldLines(held: readonly HeldAdminCapability[]): HeldLine[] {
  const names = held.map((each) => each.name);
  return held
    .filter((each) => includedBy(each.name, names) === null)
    .map((each) => ({
      holding: each.name,
      label: holdingLabel(each.name),
      how: each.direct ? 'directly' : 'through a group or role',
    }));
}

export interface MailRefusal {
  text: string;
  // Where it is put right.
  fix: 'profile' | 'email' | 'settings';
}

// The three conflicts a mail meets before it is sent, each one a fact about
// the subject or the tenant rather than a guard.
export function mailRefusal(type: string, name: string): MailRefusal | null {
  switch (type) {
    case 'about:blank#no-email':
      return { text: `${name} has no email address. Add one under Profile first.`, fix: 'profile' };
    case 'about:blank#no-mail-relay':
      return {
        text: 'The tenant has no mail relay and the deployment no sender, so the mail would only be logged. Set up a relay under Email.',
        fix: 'email',
      };
    case 'about:blank#reset-password-off':
      return {
        text: 'Password reset is off for this tenant, so its reset page would refuse the link. Turn it on in Settings.',
        fix: 'settings',
      };
    default:
      return null;
  }
}

// A service or agent subject has no `users` row: no username, email,
// profile, password or lockout, since it signs in as itself.
export function signsInAsItself(subject: Pick<Subject, 'type'>): boolean {
  return subject.type !== 'user';
}

// What a 403 or the last-administrator 409 means for a change to what a
// subject holds: a caller gives only what it holds itself, and reaches no
// subject holding more (ADR 0040). The guard's own detail is kept.
export function accessRefusal(
  name: string,
  what: 'groups' | 'roles' | 'actions',
  self = false,
): (problem: { type: string; status: number; detail?: string | undefined }) => string | null {
  return (problem) => {
    if (problem.status === 409 && problem.type === 'about:blank#last-administrator') {
      const who = self ? 'You are' : `${name} is`;
      const detail = problem.detail === undefined ? '' : ` (${problem.detail})`;
      return `${who} the last enabled administrator here, and this would take that away, so nothing was changed${detail}. Make somebody else an administrator first.`;
    }
    if (problem.status !== 403) return null;
    const ceiling = `nor can you change a subject who holds a capability you do not. It also needs manage-users.`;
    switch (what) {
      case 'groups':
        return `Refused: a group's roles are granted with it, and you can grant only capabilities you hold yourself; ${ceiling}`;
      case 'roles':
        return `Refused: you can give or take only what you hold yourself, nested in a role or not; ${ceiling}`;
      case 'actions':
        return `Refused: it needs manage-users, and ${name} may hold a capability you do not.`;
    }
  };
}

// What this console stops offering once a holding is gone.
const LOSS: Readonly<Record<Holding, string>> = {
  'tenant-admin': 'everything Full carries',
  'view-users': 'reading subjects',
  'manage-users': 'changing subjects',
  'manage-clients': 'changing clients',
  'manage-tenant': "changing this tenant's settings, roles, groups and scopes",
  'manage-keys': 'managing signing keys',
  'manage-sessions': 'ending sessions and revoking grants',
  'view-audit': 'reading the audit trail',
  'manage-tenants': 'reaching every other tenant',
};

export interface Confirmation {
  title: string;
  consequence: string;
  // Typed before it is confirmed, where the change reaches every tenant.
  typed: string | null;
}

// Asked before a save that takes admin capabilities from yourself, or takes
// manage-tenants from anybody: a plain save would land at once (§7.4).
export function removalConfirmation({
  name,
  self,
  removed,
  removesTenants,
}: {
  name: string;
  self: boolean;
  removed: readonly Holding[];
  removesTenants: boolean;
}): Confirmation | null {
  if (removed.length === 0 || (!self && !removesTenants)) return null;
  const lost = andList(removed.map(holdingLabel));
  const stops = andList(removed.map((holding) => LOSS[holding]));
  if (removesTenants) {
    return {
      title: self
        ? 'Revoke your own system administration?'
        : `Take system administration from ${name}?`,
      consequence: self
        ? `You are taking ${lost} from yourself, and with manage-tenants every other tenant. Once it lands this console stops offering ${stops}, and only another system administrator can give it back.`
        : `${name} loses ${lost}, and with manage-tenants every other tenant. Their other roles are kept; a holding through a group or a role that nests it stays until it is changed there.`,
      typed: name,
    };
  }
  return {
    title: 'Remove your own admin capabilities?',
    consequence: `You are taking ${lost} from yourself. Once it lands this console stops offering ${stops}, unless a group or another role still gives it to you, and you cannot give it back yourself.`,
    typed: null,
  };
}

export function onlyHolderText(name: string, tenant: string, counted: string): string {
  return `${name} is the only enabled holder of ${counted}, so ${tenant} would be left with nobody holding it. Give it to somebody else first.`;
}

function under(path: string, mapped: string): boolean {
  return path === mapped || path.startsWith(`${mapped}/`);
}

// Whether a membership change takes manage-tenants away: it is held only
// through groups (its own, or Full's), some group the subject was in reached
// one of them, and none it is left in does. A role mapped to a group reaches
// every group beneath it.
export function takesTenants(
  effective: readonly EffectiveRoleAssignment[],
  before: readonly string[],
  after: readonly string[],
): boolean {
  const carriers = effective.filter(
    (role) => isAdminRole(role) && (role.name === 'manage-tenants' || role.name === 'tenant-admin'),
  );
  const otherwise = carriers.some((role) =>
    role.via.some(
      (via) =>
        via.kind === 'direct' || (via.kind === 'composite' && via.parent_name !== 'tenant-admin'),
    ),
  );
  const mapped = carriers.flatMap((role) =>
    role.via.flatMap((via) => (via.kind === 'group' ? [via.group_path] : [])),
  );
  if (otherwise || mapped.length === 0) return false;
  const reaches = (paths: readonly string[]): boolean =>
    paths.some((path) => mapped.some((group) => under(path, group)));
  return reaches(before) && !reaches(after);
}

// A read as the hooks hand it to a service: the services judge what it says
// without knowing which hook made it.
export type Loaded<T> =
  { status: 'loading' } | { status: 'ready'; data: T } | { status: 'failed'; retry: () => void };

export function subjectCreatedText(name: string): string {
  return `${createdText(name)} It has no password yet: issue a one-time password from its Credentials tab.`;
}

export function newSubjectSpec(name: string): CreateSpec {
  return {
    noun: 'subject',
    name,
    fields: ['username', 'email'],
    capability: 'manage-users',
    schema: `${name} may have been created, but the answer could not be read. Look for it.`,
    refused: (problem) =>
      problem.status === 403
        ? `${name} was not created: it needs the manage-users capability.`
        : null,
  };
}

// Offered only while whoami says nothing rules creating out.
export function createSubjectHref(
  tenant: string,
  lacking: readonly AdminCapability[],
): string | null {
  return lacking.length === 0 ? newSubjectHref(tenant) : null;
}

export function membersListHref(tenant: string, by: 'group' | 'role', id: string): string {
  return `${subjectsHref(tenant)}?${new URLSearchParams({ [by]: id }).toString()}`;
}

export type OwnRoles =
  | { status: 'loading' }
  | {
      status: 'ready';
      roles: readonly EffectiveRoleAssignment[];
      // The paths of the groups it belongs to directly.
      groups: readonly string[];
    }
  | { status: 'unknown' };

export function ownRolesOf({
  member,
  authority,
  roles,
  groups,
}: {
  member: boolean;
  authority: Authority | undefined;
  roles: Loaded<{ items: readonly EffectiveRoleAssignment[] }>;
  groups: Loaded<{ items: readonly { path: string }[] }>;
}): OwnRoles {
  if (!member) return { status: 'ready', roles: [], groups: [] };
  if (authority === undefined) return { status: 'loading' };
  if (!holds(authority, 'view-users')) return { status: 'unknown' };
  if (roles.status === 'failed' || groups.status === 'failed') return { status: 'unknown' };
  if (roles.status === 'loading' || groups.status === 'loading') return { status: 'loading' };
  return {
    status: 'ready',
    roles: roles.data.items,
    groups: groups.data.items.map((group) => group.path),
  };
}

export function changeFailureText(failure: GatewayFailure, capability: AdminCapability): string {
  switch (failure.kind) {
    case 'network':
      return 'Could not confirm the result. Nothing was sent again; the tab shows what the server holds now.';
    case 'schema':
      return 'It may have happened, but the answer could not be read. The tab shows what the server holds now.';
    case 'defect':
      return 'The console could not finish. This is a fault in the console, not something you did.';
    case 'problem':
      if (failure.problem.status === 403) {
        return `Refused: it needs the ${capability} capability, or the subject holds an admin capability you do not.`;
      }
      if (failure.problem.status === 404) return 'It is already gone.';
      return `Refused: ${failure.problem.detail ?? failure.problem.title}`;
  }
}

export function enabledVerb(enabled: boolean): 'enabled' | 'disabled' {
  return enabled ? 'enabled' : 'disabled';
}

export function subjectWriteFailure(failure: GatewayFailure, name: string, verb: string): string {
  return writeFailureText(failure, {
    name,
    verb,
    lookAt: 'the subject',
    stale: `${name} changed elsewhere since you opened it, so it was not ${verb}. It has been read again; look at it before trying again.`,
    refused: (problem) =>
      problem.status === 403
        ? `${name} was not ${verb}: it needs the manage-users capability, or ${name} holds an admin capability you do not.`
        : null,
  });
}

export type UsernameMode =
  // Offered: the tenant's policy accepts a rename.
  | { kind: 'editable'; description: string }
  // Not offered: the policy is off, and this is why.
  | { kind: 'fixed'; reason: string; settingsHref: string }
  | { kind: 'failed'; retry: () => void }
  | { kind: 'checking' };

export function usernameMode(
  policy:
    | { status: 'loading' }
    | { status: 'ready'; editable: boolean }
    | { status: 'failed'; retry: () => void },
  settingsHref: string,
): UsernameMode {
  switch (policy.status) {
    case 'loading':
      return { kind: 'checking' };
    case 'failed':
      return { kind: 'failed', retry: policy.retry };
    case 'ready':
      return policy.editable
        ? { kind: 'editable', description: USERNAME_RULE_TEXT }
        : {
            kind: 'fixed',
            reason:
              "Usernames in this tenant are fixed: its username_editable setting is off, so a rename would be refused. Turn it on under the tenant's",
            settingsHref,
          };
  }
}

export type CredentialChange =
  { kind: 'factor'; credentialId: string } | { kind: 'recovery-codes' } | { kind: 'lockout' };

export type Asking =
  | { kind: 'password' }
  | { kind: 'factor'; credential: Credential }
  | { kind: 'recovery-codes' }
  | { kind: 'lockout' };

type Change = Exclude<Asking, { kind: 'password' }>;

export function credentialChangeOf(asking: Change): CredentialChange | null {
  switch (asking.kind) {
    case 'factor':
      return asking.credential.id === undefined
        ? null
        : { kind: 'factor', credentialId: asking.credential.id };
    case 'recovery-codes':
      return { kind: 'recovery-codes' };
    case 'lockout':
      return { kind: 'lockout' };
  }
}

export function credentialDoneText(name: string, asking: Change): string {
  switch (asking.kind) {
    case 'factor':
      return `${factorLabel(asking.credential.type)} removed from ${name}.`;
    case 'recovery-codes':
      return `${name}'s recovery codes are revoked.`;
    case 'lockout':
      return `${name}'s lockout is cleared.`;
  }
}

export function credentialFailureText(what: string, failure: GatewayFailure): string {
  switch (failure.kind) {
    case 'network':
      return `Could not confirm the result. ${what} has not been sent again; the tab shows what the server holds now.`;
    case 'schema':
      return `${what} may have happened, but the answer could not be read. The tab shows what the server holds now.`;
    case 'defect':
      return 'The console could not finish. This is a fault in the console, not something you did.';
    case 'problem':
      if (failure.problem.status === 403) {
        return 'Refused: it needs the manage-users capability, or the subject holds an admin capability you do not.';
      }
      return `Refused: ${failure.problem.detail ?? failure.problem.title}`;
  }
}

export interface CredentialDialog {
  title: string;
  consequence: string;
  confirmLabel: string;
  tone: 'primary' | 'danger';
}

export function credentialDialog(asking: Asking, name: string, self: boolean): CredentialDialog {
  switch (asking.kind) {
    case 'password':
      return {
        title: `Issue ${name} a one-time password?`,
        consequence: self
          ? 'This replaces your own password, and you must change it at your next sign-in. Any lockout is cleared. No session ends, this one included.'
          : `This replaces the password ${name} has, and they must change it at their next sign-in. Any lockout is cleared. No session ends and no grant is revoked.`,
        confirmLabel: 'Issue password',
        tone: 'primary',
      };
    case 'factor': {
      const label = factorLabel(asking.credential.type);
      const lowered = `${label.charAt(0).toLowerCase()}${label.slice(1)}`;
      return {
        title: `Remove ${name}’s ${lowered}?`,
        consequence: `${name}'s next sign-in no longer offers or asks for this ${lowered}. Signing in with it again needs a new enrolment.`,
        confirmLabel: 'Remove',
        tone: 'danger',
      };
    }
    case 'recovery-codes':
      return {
        title: `Revoke ${name}’s recovery codes?`,
        consequence: `Every recovery code ${name} holds stops working, unspent ones too. They get a fresh set only when one is asked of them, as the generate-recovery-codes required action.`,
        confirmLabel: 'Revoke recovery codes',
        tone: 'danger',
      };
    case 'lockout':
      return {
        title: `Clear ${name}’s lockout?`,
        consequence: `The run of failed sign-ins is forgotten, so ${name}'s next right password signs in at once, and the next wrong one counts from one.`,
        confirmLabel: 'Clear lockout',
        tone: 'primary',
      };
  }
}

export function recoveryCodesText(name: string, count: number | null): string {
  if (count === null || count === 0) return `No recovery codes: ${name} holds no unspent one.`;
  return `${counted(count, 'unspent recovery code', 'unspent recovery codes')}`;
}

const REQUIRED_ACTION_ORDER = REQUIRED_ACTIONS.map((each) => each.action);

export function requiredActionsInOrder(actions: readonly string[]): RequiredAction[] {
  return inOrderOf(REQUIRED_ACTION_ORDER, actions);
}

export function describeActions(value: unknown): string {
  const labels = requiredActionsInOrder(Array.isArray(value) ? value.map(String) : []).map(
    (action) => REQUIRED_ACTIONS.find((each) => each.action === action)?.label ?? action,
  );
  return labels.length === 0 ? 'none' : labels.join(', ');
}

export interface Membership {
  id: string;
  // The path, or the id where the group is known by nothing else yet.
  path: string;
  description: string | null;
}

export function membershipsOf(
  ids: readonly string[],
  known: ReadonlyMap<string, { path: string; description?: string | null }>,
): Membership[] {
  return ids.map((id) => {
    const group = known.get(id);
    return { id, path: group?.path ?? id, description: group?.description ?? null };
  });
}

export function leftGroups(
  held: readonly { id: string; path: string }[],
  chosen: readonly string[],
): string[] {
  return held.filter((group) => !chosen.includes(group.id)).map((group) => group.path);
}

// Leaving a group of your own takes every role it carries with it.
export function leaveConfirmation(self: boolean, left: readonly string[]): Confirmation | null {
  if (!self || left.length === 0) return null;
  return {
    title: 'Leave groups of your own?',
    consequence: `You are leaving ${left.join(', ')}. Every role a group carries goes with it, admin capabilities among them, so this console may stop offering some of what it offers you now, and you may not be able to join again yourself.`,
    typed: null,
  };
}

export function groupsRemoveTenants(
  tenant: string,
  effective: Loaded<{ items: readonly EffectiveRoleAssignment[] }>,
  before: readonly string[],
  after: readonly string[],
): boolean {
  return (
    tenant === SYSTEM_TENANT &&
    effective.status === 'ready' &&
    takesTenants(effective.data.items, before, after)
  );
}

export interface Assignment {
  id: string;
  name: string;
  // The client it belongs to, by its client_id, or null for a tenant role.
  client: string | null;
}

export function knownAssignments(
  ...lists: (readonly { id: string; name: string; client_key: string | null }[])[]
): ReadonlyMap<string, Assignment> {
  return new Map(
    lists
      .flat()
      .map((role) => [role.id, { id: role.id, name: role.name, client: role.client_key }]),
  );
}

export function assignmentsOf(
  ids: readonly string[],
  known: ReadonlyMap<string, Assignment>,
): Assignment[] {
  return ids.map((id) => known.get(id) ?? { id, name: id, client: null });
}

export function roleUnavailableHere(role: {
  name: string;
  client_key: string | null;
}): string | null {
  return isAdminRole(role) ? 'an admin capability: set it under Admin capabilities' : null;
}

export function roleOwnerOf(client: string | null): string {
  return client === null ? 'tenant role' : `client ${client}`;
}

export const PROFILE_SECTIONS = [
  { id: 'name', title: 'Name', claims: NAME_CLAIMS },
  { id: 'details', title: 'Details', claims: DETAIL_CLAIMS },
  { id: 'address', title: 'Address', claims: ADDRESS_CLAIMS },
] as const;

export type ProfileSection = (typeof PROFILE_SECTIONS)[number];

export function claimFields(
  profile: Profile,
  claims: readonly ClaimField[],
): SectionFields<Readonly<Record<string, string>>> {
  return Object.fromEntries(
    claims.map((claim) => [
      claim.id,
      { value: profile[claim.id] ?? '', label: claim.label, kind: 'plain' as const },
    ]),
  );
}

export type MailKind = 'reset' | 'verification' | 'actions';

export interface MailOutcome {
  sent: boolean;
  text: string;
  // Where the refusal is put right, when it is a fact about the tenant or subject.
  fix: { label: string; href: string } | null;
}

const MAIL_FIX_LABEL: Readonly<Record<MailRefusal['fix'], string>> = {
  profile: 'Profile',
  email: 'Email',
  settings: 'Settings',
};

export function mailOutcome(
  failure: GatewayFailure,
  name: string,
  hrefs: Readonly<Record<MailRefusal['fix'], string>>,
): MailOutcome {
  switch (failure.kind) {
    case 'network':
      return {
        sent: false,
        text: 'Could not confirm the mail was sent. It has not been asked for again; nothing shows whether it went, so ask again only if it is still owed.',
        fix: null,
      };
    case 'schema':
      return {
        sent: true,
        text: 'The mail was asked for, but the answer could not be read.',
        fix: null,
      };
    case 'defect':
      return {
        sent: false,
        text: 'The console could not finish. This is a fault in the console, not something you did.',
        fix: null,
      };
    case 'problem': {
      const said = mailRefusal(failure.problem.type, name);
      if (said !== null) {
        return {
          sent: false,
          text: said.text,
          fix: { label: MAIL_FIX_LABEL[said.fix], href: hrefs[said.fix] },
        };
      }
      if (failure.problem.status === 403) {
        return {
          sent: false,
          text: `Refused: it needs the manage-users capability, or ${name} holds an admin capability you do not.`,
          fix: null,
        };
      }
      return {
        sent: false,
        text: `Not sent: ${failure.problem.detail ?? failure.problem.title}`,
        fix: null,
      };
    }
  }
}

// Only the actions mail has a field a 400 can name.
export function mailFieldErrors(kind: MailKind, failure: GatewayFailure): FieldErrors | null {
  if (kind !== 'actions' || failure.kind !== 'problem' || failure.problem.status !== 400) {
    return null;
  }
  return fieldErrorsOf(failure.problem, ['actions']);
}

export function mailSentText(kind: MailKind, email: string | null, count = 0): string {
  const address = email ?? 'their address';
  switch (kind) {
    case 'reset':
      return `A password reset link was sent to ${address}.`;
    case 'verification':
      return `A verification link was sent to ${address}.`;
    case 'actions':
      return `A link through ${counted(count, 'action', 'actions')} was sent to ${address}. Following it asks for each, in order.`;
  }
}

export function actionsMailProblem(actions: readonly RequiredAction[]): { actions: string } | null {
  return actions.length === 0 ? { actions: 'Choose at least one action.' } : null;
}

export function sessionEndedText(name: string): string {
  return `The session of ${name} ended.`;
}

export function sessionsEndedText(name: string, count: number): string {
  return `${counted(count, 'session', 'sessions')} of ${name} ended.`;
}

export function consentRevokedText(name: string, clientKey: string): string {
  return `${name}'s consent to ${clientKey} revoked.`;
}

export function grantsRevokedText(name: string, count: number, clientKey: string): string {
  return `${counted(count, 'grant', 'grants')} of ${name} through ${clientKey} revoked.`;
}

export interface GrantClient {
  id: string;
  key: string;
}

// Each client a listed grant was issued through, once: a revoke takes them all.
export function grantClients(
  grants: readonly { client_id: string; client_key: string }[],
): GrantClient[] {
  const clients = new Map(grants.map((grant) => [grant.client_id, grant.client_key]));
  return [...clients].map(([id, key]) => ({ id, key }));
}

export function heldOf(
  effective: Loaded<{ items: readonly EffectiveRoleAssignment[] }>,
): ReadonlyMap<Holding, Held> {
  return effective.status === 'ready' ? heldCapabilities(effective.data.items) : new Map();
}

// Admin capabilities the subject holds and the caller does not (ADR 0040's
// target ceiling); none until both are known.
export function subjectBeyond(
  effective: Loaded<{ items: readonly EffectiveRoleAssignment[] }>,
  caller: readonly AdminCapability[] | undefined,
): AdminCapability[] {
  return caller === undefined ? [] : beyondCaller([...heldOf(effective).keys()], caller);
}

export function canManageSubject(
  lacking: readonly AdminCapability[],
  effective: Loaded<unknown>['status'],
  beyond: readonly AdminCapability[],
): boolean {
  return lacking.length === 0 && effective === 'ready' && beyond.length === 0;
}

export function reachOf(
  effective: Loaded<unknown>,
): 'checking' | 'ready' | { failed: true; retry: () => void } {
  switch (effective.status) {
    case 'ready':
      return 'ready';
    case 'loading':
      return 'checking';
    case 'failed':
      return { failed: true, retry: effective.retry };
  }
}

// `view` is the line a record carries in place of every write the server
// would refuse; `change` is the one inside the capability editor.
export function beyondText(
  name: string,
  beyond: readonly string[],
  mode: 'change' | 'view',
): string {
  const holds = `${name} holds ${andList(beyond)}, which you do not, so you`;
  return mode === 'change'
    ? `${holds} cannot change what ${name} holds.`
    : `${holds} can view ${name} but change nothing here.`;
}

export function roleIdsOf(
  holdings: readonly Holding[],
  adminRoles: ReadonlyMap<Holding, string> | null,
): { ids: string[] } | { missing: Holding[] } {
  if (adminRoles === null) return { missing: [...holdings] };
  const missing = holdings.filter((holding) => !adminRoles.has(holding));
  if (missing.length > 0) return { missing };
  return { ids: holdings.flatMap((holding) => adminRoles.get(holding) ?? []) };
}

// What else, beyond the boxes, keeps the counted capability with them. Full
// counts too when a group or another role carries it, since the box only
// takes away what is assigned here.
export function keptOtherwise(held: ReadonlyMap<Holding, Held>, counted: Holding): boolean {
  return (
    (held.get(counted)?.through ?? []).some((path) => path !== `within ${TENANT_ADMIN}`) ||
    (counted !== TENANT_ADMIN && (held.get(TENANT_ADMIN)?.through.length ?? 0) > 0)
  );
}

export function capabilitiesRemoveTenants(
  tenant: string,
  base: readonly string[],
  chosen: readonly string[],
  kept: boolean,
): boolean {
  const reaches = (holdings: readonly string[]): boolean =>
    holdings.some((holding) => holding === TENANT_ADMIN || holding === MANAGE_TENANTS);
  return tenant === SYSTEM_TENANT && reaches(base) && !reaches(chosen) && !kept;
}

// The one holding whose removal would leave the tenant with no enabled
// holder of what the last-administrator guard counts; null when none.
export function onlyHolder({
  enabled,
  held,
  counted,
  holders,
  keptOtherwise: kept,
  chosen,
}: {
  enabled: boolean;
  held: ReadonlyMap<Holding, Held>;
  counted: Holding;
  holders: Loaded<{ count: number; capped: boolean }>;
  keptOtherwise: boolean;
  chosen: readonly string[];
}): Holding | null {
  const carriers = [...new Set<Holding>([TENANT_ADMIN, counted])].filter((holding) =>
    chosen.includes(holding),
  );
  const only =
    enabled &&
    held.has(counted) &&
    holders.status === 'ready' &&
    !holders.data.capped &&
    holders.data.count === 1 &&
    !kept &&
    carriers.length === 1;
  return only ? (carriers[0] ?? null) : null;
}

export function capabilityOptions({
  tenant,
  name,
  chosen,
  caller,
  held,
  guarded,
  counted,
}: {
  tenant: string;
  name: string;
  chosen: readonly string[];
  caller: readonly AdminCapability[] | undefined;
  held: ReadonlyMap<Holding, Held>;
  guarded: Holding | null;
  counted: string;
}): HoldingOption[] {
  return holdingOptions(tenant, chosen, caller, {
    held,
    guard: (holding) => (holding === guarded ? onlyHolderText(name, tenant, counted) : null),
  });
}

export interface HeldElsewhere {
  label: string;
  through: string;
}

// A holding the subject has only through a group or a role that nests it,
// which only that group or role can take away.
export function heldElsewhere(
  held: ReadonlyMap<Holding, Held>,
  chosen: readonly string[],
): HeldElsewhere[] {
  return [...held]
    .filter(([holding, how]) => {
      if (how.direct || includedBy(holding, chosen) !== null) return false;
      return how.through.some((path) => !path.startsWith('within '));
    })
    .map(([holding, how]) => ({ label: holdingLabel(holding), through: how.through.join(', ') }));
}

export function elsewhereText(name: string, elsewhere: readonly HeldElsewhere[]): string {
  const held = andList(elsewhere.map((each) => `${each.label} ${each.through}`));
  return `${held}: only that group or role takes it away, on ${name}’s `;
}

export function describeHoldings(value: unknown): string {
  const named = Array.isArray(value) ? value.map(String).filter(isHolding) : [];
  return named.length === 0 ? 'none' : named.map(holdingLabel).join(', ');
}

export function adminRolesBlocked(
  status: 'loading' | 'ready' | 'failed',
  blocked: string | undefined,
): string | undefined {
  if (status === 'loading') return 'The admin roles are still being read.';
  if (status === 'failed') return 'The admin roles could not be read, so nothing can be saved.';
  return blocked;
}

// manage-tenants, which in system reaches every other tenant.
export function reachesEveryTenant(
  tenant: string,
  held: readonly Pick<HeldAdminCapability, 'name'>[],
): boolean {
  return (
    tenant === SYSTEM_TENANT &&
    held.some((each) => each.name === MANAGE_TENANTS || each.name === TENANT_ADMIN)
  );
}

export function holderFilterOptions(tenant: string): { id: string; label: string }[] {
  return [
    { id: 'any', label: 'Any capability' },
    { id: 'tenant-admin', label: 'Full (tenant-admin)' },
    ...grantableIn(tenant).map((capability) => ({ id: capability, label: capability })),
  ];
}
