import {
  USERNAME_RULE,
  type Credential,
  type EffectiveRoleAssignment,
  type Lockout,
  type Profile,
  type RequiredAction,
  type Subject,
} from '@odudu/contracts/admin';
import type { Crumb } from '#/shared/service/breadcrumb.ts';
import {
  holdingLabel,
  isAdminRole,
  isHolding,
  provenanceText,
  type Holding,
} from '#/shared/service/capabilities.ts';
import { formatAbsolute } from '#/shared/service/format.ts';

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
  holding: Holding;
  label: string;
  how: string;
}

// What a holder holds, leaving out what another of its holdings already
// carries: tenant-admin's nested capabilities are said by "Full".
export function heldSummary(effective: readonly EffectiveRoleAssignment[]): HeldLine[] {
  const admin = effective.filter((role) => isAdminRole(role));
  const names = new Set(admin.map((role) => role.name));
  return admin.flatMap((role) => {
    if (!isHolding(role.name)) return [];
    const own = role.via.filter((via) => via.kind !== 'composite' || !names.has(via.parent_name));
    if (own.length === 0) return [];
    return [
      {
        holding: role.name,
        label: holdingLabel(role.name),
        how: own.map(provenanceText).join(', '),
      },
    ];
  });
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
// subject holding more (ADR 0040).
export function accessRefusal(
  name: string,
  what: 'groups' | 'roles' | 'actions',
): (problem: { type: string; status: number }) => string | null {
  return (problem) => {
    if (problem.status === 409 && problem.type === 'about:blank#last-administrator') {
      return `${name} is the last enabled administrator here, and this would take that from them, so nothing was changed. Make somebody else an administrator first.`;
    }
    if (problem.status !== 403) return null;
    const ceiling = `nor can you change a subject who holds a capability you do not (ADR 0040). It also needs manage-users.`;
    switch (what) {
      case 'groups':
        return `Refused: a group's roles are granted with it, and you can grant only capabilities you hold yourself; ${ceiling}`;
      case 'roles':
        return `Refused: you can give or take only what you hold yourself, nested in a role or not; ${ceiling}`;
      case 'actions':
        return `Refused: it needs manage-users, and ${name} may hold a capability you do not (ADR 0040).`;
    }
  };
}
