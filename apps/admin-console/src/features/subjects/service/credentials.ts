import { type Credential, type Lockout } from '@odudu/contracts/admin';
import { counted, formatAbsolute } from '#/shared/service/format.ts';
import type { GatewayFailure } from '#/shared/service/result.ts';

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

export function credentialDialogOf(
  asking: Asking | null,
  name: string,
  self: boolean,
): CredentialDialog | null {
  return asking === null ? null : credentialDialog(asking, name, self);
}

export function recoveryCodesText(name: string, count: number | null): string {
  if (count === null || count === 0) return `No recovery codes: ${name} holds no unspent one.`;
  return counted(count, 'unspent recovery code', 'unspent recovery codes');
}
