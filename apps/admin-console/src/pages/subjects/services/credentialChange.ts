import type { AskedChange } from '#/pages/subjects/services/credentialAsk';
import { type Choices } from '#/pages/subjects/services/credentialChoices';

export type CredentialChange =
  | { kind: 'factor'; credentialId: string; endSessions: boolean }
  | { kind: 'recovery-codes'; requireNewSet: boolean }
  | { kind: 'lockout' };

// Which read a change leaves stale: a lockout's own, or the credentials list.
export function staleReadOf(change: CredentialChange): 'credentials' | 'lockout' {
  return change.kind === 'lockout' ? 'lockout' : 'credentials';
}

export function credentialChangeOf(asking: AskedChange, choices: Choices): CredentialChange | null {
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
