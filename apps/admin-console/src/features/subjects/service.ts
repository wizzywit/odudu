import {
  USERNAME_RULE,
  type Credential,
  type Lockout,
  type Profile,
  type Subject,
} from '@odudu/contracts/admin';

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

export function subjectName(subject: Pick<Subject, 'id' | 'type' | 'username'>): string {
  return subject.username ?? `${subject.type} ${subject.id}`;
}

export const USERNAME_RULE_TEXT = `${USERNAME_RULE.charAt(0).toUpperCase()}${USERNAME_RULE.slice(1)}.`;

export function usernameProblem(username: string): string | null {
  return username === '' ? 'Enter a username.' : null;
}

type Claim = keyof Omit<Profile, 'email_verified' | 'phone_number_verified' | 'profile_updated_at'>;

export interface ClaimField {
  readonly id: Claim;
  readonly label: string;
  readonly type?: 'url';
}

export const NAME_CLAIMS: readonly ClaimField[] = [
  { id: 'name', label: 'Full name' },
  { id: 'given_name', label: 'Given name' },
  { id: 'family_name', label: 'Family name' },
  { id: 'middle_name', label: 'Middle name' },
  { id: 'nickname', label: 'Nickname' },
  { id: 'preferred_username', label: 'Preferred username' },
];

export const DETAIL_CLAIMS: readonly ClaimField[] = [
  { id: 'phone_number', label: 'Phone number' },
  { id: 'profile', label: 'Profile page', type: 'url' },
  { id: 'picture', label: 'Picture', type: 'url' },
  { id: 'website', label: 'Website', type: 'url' },
  { id: 'gender', label: 'Gender' },
  { id: 'birthdate', label: 'Birthdate' },
  { id: 'zoneinfo', label: 'Time zone' },
  { id: 'locale', label: 'Locale' },
];

export const ADDRESS_CLAIMS: readonly ClaimField[] = [
  { id: 'address_formatted', label: 'Formatted address' },
  { id: 'address_street', label: 'Street' },
  { id: 'address_locality', label: 'Locality' },
  { id: 'address_region', label: 'Region' },
  { id: 'address_postal_code', label: 'Postal code' },
  { id: 'address_country', label: 'Country' },
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

// A service or agent subject has no `users` row: no username, email,
// profile, password or lockout, since it signs in as itself.
export function signsInAsItself(subject: Pick<Subject, 'type'>): boolean {
  return subject.type !== 'user';
}
