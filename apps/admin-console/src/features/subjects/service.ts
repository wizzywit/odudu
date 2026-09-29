import {
  USERNAME_RULE,
  type Credential,
  type Lockout,
  type Profile,
  type Subject,
} from '@odudu/contracts/admin';
import type { Crumb } from '#/shared/service/breadcrumb.ts';
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
  readonly id: Claim;
  readonly label: string;
  readonly input: ClaimInput;
  // The HTML token naming what a text claim holds (WCAG 1.3.5); a typed
  // field carries its own.
  readonly autoComplete?: string;
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
  { id: 'phone_number', label: 'Phone number', input: 'phone' },
  { id: 'profile', label: 'Profile page', input: 'url', autoComplete: 'url' },
  { id: 'picture', label: 'Picture', input: 'picture', autoComplete: 'photo' },
  { id: 'website', label: 'Website', input: 'url', autoComplete: 'url' },
  { id: 'gender', label: 'Gender', input: 'gender' },
  { id: 'birthdate', label: 'Birthdate', input: 'birthdate' },
  { id: 'zoneinfo', label: 'Time zone', input: 'zone' },
  { id: 'locale', label: 'Locale', input: 'locale' },
];

// The formatted address is the whole address as one text; HTML names no
// autofill purpose for that.
export const ADDRESS_CLAIMS: readonly ClaimField[] = [
  { id: 'address_formatted', label: 'Formatted address', input: 'text' },
  { id: 'address_street', label: 'Street', input: 'text', autoComplete: 'street-address' },
  { id: 'address_locality', label: 'Locality', input: 'text', autoComplete: 'address-level2' },
  { id: 'address_region', label: 'Region', input: 'text', autoComplete: 'address-level1' },
  { id: 'address_postal_code', label: 'Postal code', input: 'text', autoComplete: 'postal-code' },
  { id: 'address_country', label: 'Country', input: 'country' },
];

export interface Credentials {
  readonly password: Credential | null;
  // A TOTP enrolment or a passkey, each removable on its own.
  readonly factors: readonly Credential[];
  // Unspent codes, or null when none was ever issued.
  readonly recoveryCodes: number | null;
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
  readonly tone: 'neutral' | 'danger';
  readonly state: 'locked' | 'not locked';
  readonly text: string;
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
export const SUBJECT_TABS = ['profile', 'credentials'] as const;
export type SubjectTab = (typeof SUBJECT_TABS)[number];

export const SUBJECT_TAB_LABELS: Readonly<Record<SubjectTab, string>> = {
  profile: 'Profile',
  credentials: 'Credentials',
};

export function subjectRecord(id: string): string {
  return `subjects/${id}`;
}

export function profileRecord(id: string): string {
  return `subjects/${id}/profile`;
}

// The records whose sections each tab edits, so its dot follows them.
export const TAB_RECORDS: Readonly<Record<SubjectTab, (id: string) => readonly string[]>> = {
  profile: (id) => [subjectRecord(id), profileRecord(id)],
  credentials: () => [],
};

// A service or agent subject has no `users` row: no username, email,
// profile, password or lockout, since it signs in as itself.
export function signsInAsItself(subject: Pick<Subject, 'type'>): boolean {
  return subject.type !== 'user';
}
