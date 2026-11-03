import type { Read } from '#/shared/services/read';
import type { NamedDialog } from '#/shared/services/dialog';
import { lowerFirst } from '#/shared/services/format';
import { credentialsOf, factorLabel } from '#/pages/subjects/services/credentialList';
import { type Credential } from '#/pages/subjects/types/credential';

export type Asking =
  | { kind: 'password' }
  // `last`: the only authenticator app or passkey the subject holds.
  | { kind: 'factor'; credential: Credential; last: boolean }
  // `hasFactor`: a second factor remains, so a new set can be asked for.
  | { kind: 'recovery-codes'; hasFactor: boolean }
  | { kind: 'lockout' };

export type AskedChange = Exclude<Asking, { kind: 'password' }>;

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
  credentials: Read<Credential[]>,
): Asking | null {
  if (asking === null || credentials.status !== 'ready') return asking;
  const { factors } = credentialsOf(credentials.data);
  if (asking.kind === 'factor') return { ...asking, last: factors.length <= 1 };
  if (asking.kind === 'recovery-codes') return { ...asking, hasFactor: factors.length > 0 };
  return asking;
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
