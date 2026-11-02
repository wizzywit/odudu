import {
  END_SESSIONS_NEEDS_MANAGE_SESSIONS,
  type Credential,
  type ListCredentialsResponse,
  type Lockout,
} from '@odudu/contracts/admin';
import type { Read } from '#/shared/services/read';
import type { NamedDialog } from '#/shared/services/dialog';
import { COULD_NOT_FINISH } from '#/shared/services/failure';
import { counted, formatAbsolute, lowerFirst } from '#/shared/services/format';
import type { GatewayFailure } from '#/shared/services/result';
import { subjectRefusal } from '#/features/subjects/services/access';

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
  return counted(count, 'failed sign-in', 'failed sign-ins');
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

export type CredentialChange =
  | { kind: 'factor'; credentialId: string; endSessions: boolean }
  | { kind: 'recovery-codes'; requireNewSet: boolean }
  | { kind: 'lockout' };

// Which read a change leaves stale: a lockout's own, or the credentials list.
export function staleReadOf(change: CredentialChange): 'credentials' | 'lockout' {
  return change.kind === 'lockout' ? 'lockout' : 'credentials';
}

export type Asking =
  | { kind: 'password' }
  // `last`: the only authenticator app or passkey the subject holds.
  | { kind: 'factor'; credential: Credential; last: boolean }
  // `hasFactor`: a second factor remains, so a new set can be asked for.
  | { kind: 'recovery-codes'; hasFactor: boolean }
  | { kind: 'lockout' };

type Change = Exclude<Asking, { kind: 'password' }>;

export function askToRemove(factors: readonly Credential[], credential: Credential): Asking {
  return { kind: 'factor', credential, last: factors.length <= 1 };
}

export function askToRevoke(factors: readonly Credential[]): Asking {
  return { kind: 'recovery-codes', hasFactor: factors.length > 0 };
}

// An ask is made against the list the tab held when it was made, and the
// dialog is said against the list as it stands now: another administrator's
// change, or one in another tab, moves what is the last factor.
export function askingAgainst(
  asking: Asking | null,
  credentials: Read<ListCredentialsResponse>,
): Asking | null {
  if (asking === null || credentials.status !== 'ready') return asking;
  const { factors } = credentialsOf(credentials.data.items);
  if (asking.kind === 'factor') return { ...asking, last: factors.length <= 1 };
  if (asking.kind === 'recovery-codes') return { ...asking, hasFactor: factors.length > 0 };
  return asking;
}

export interface Choices {
  newSet: boolean;
  endSessions: boolean;
}

export type ChoiceKey = keyof Choices;

// A new set is asked for unless the operator says otherwise: revoking a set
// from somebody who keeps a factor would otherwise leave them without a way
// back and without a prompt. Ending sessions is never the default, because
// whether the factor was lost is something only the operator knows.
export const CHOICE_DEFAULTS: Choices = { newSet: true, endSessions: false };

export function choicesWith(choices: Choices, key: ChoiceKey, checked: boolean): Choices {
  return { ...choices, [key]: checked };
}

export function choiceKeyOf(asking: Asking | null): ChoiceKey | null {
  if (asking === null) return null;
  if (asking.kind === 'factor') return asking.last ? 'endSessions' : null;
  if (asking.kind === 'recovery-codes') return asking.hasFactor ? 'newSet' : null;
  return null;
}

export interface ChoiceControl {
  checked: boolean;
  onChange: (checked: boolean) => void;
}

// What the dialog draws for the choice the ask offers, or nothing.
export function choiceControl(
  asking: Asking | null,
  choices: Choices,
  set: (next: Choices) => void,
): ChoiceControl | null {
  const key = choiceKeyOf(asking);
  if (key === null) return null;
  return {
    checked: choices[key],
    onChange: (checked) => {
      set(choicesWith(choices, key, checked));
    },
  };
}

export function credentialChangeOf(asking: Change, choices: Choices): CredentialChange | null {
  switch (asking.kind) {
    case 'factor':
      return asking.credential.id === undefined
        ? null
        : {
            kind: 'factor',
            credentialId: asking.credential.id,
            endSessions: asking.last && choices.endSessions,
          };
    case 'recovery-codes':
      return { kind: 'recovery-codes', requireNewSet: asking.hasFactor && choices.newSet };
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
      return COULD_NOT_FINISH;
    case 'problem':
      if (failure.problem.status === 403) {
        // The one refusal that is the caller's own: ending sessions needs a
        // capability the removal itself does not.
        if (failure.problem.detail === END_SESSIONS_NEEDS_MANAGE_SESSIONS) {
          return `Refused: ${subjectRefusal('the subject', 'manage-sessions')}`;
        }
        return `Refused: ${subjectRefusal('the subject', 'manage-users')}`;
      }
      return `Refused: ${failure.problem.detail ?? failure.problem.title}`;
  }
}

export function credentialDialog(asking: Asking, name: string, self: boolean): NamedDialog {
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
      const lowered = lowerFirst(label);
      const last = asking.last
        ? ` It is ${name}'s last second factor, so their recovery codes are revoked with it, and a later enrolment issues a fresh set.`
        : '';
      return {
        title: `Remove ${name}’s ${lowered}?`,
        consequence: `${name}'s next sign-in no longer offers or asks for this ${lowered}. Signing in with it again needs a new enrolment.${last} ${name} is told by email, if they have an address.`,
        confirmLabel: 'Remove',
        tone: 'danger',
        ...(asking.last
          ? {
              choice: {
                label: `Also end ${name}’s sessions`,
                note: `Left unticked, ${name} stays signed in wherever they are. Tick it if the factor was lost or stolen: every session ends, and the next sign-in is by password alone.`,
              },
            }
          : {}),
      };
    }
    case 'recovery-codes':
      return {
        title: `Revoke ${name}’s recovery codes?`,
        consequence: `Every recovery code ${name} holds stops working, unspent ones too. ${name} is told by email, if they have an address.`,
        confirmLabel: 'Revoke recovery codes',
        tone: 'danger',
        ...(asking.hasFactor
          ? {
              choice: {
                label: 'Ask for a new set at next sign-in',
                note: `Unticked, ${name} has no recovery codes until one is asked of them as the generate-recovery-codes required action.`,
              },
            }
          : {}),
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

export function credentialDialogOf(
  asking: Asking | null,
  name: string,
  self: boolean,
): NamedDialog | null {
  return asking === null ? null : credentialDialog(asking, name, self);
}

export function recoveryCodesText(name: string, count: number | null): string {
  if (count === null || count === 0) return `No recovery codes: ${name} holds no unspent one.`;
  return counted(count, 'unspent recovery code', 'unspent recovery codes');
}
