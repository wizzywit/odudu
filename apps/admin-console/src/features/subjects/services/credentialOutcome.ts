import type { AskedChange } from '#/features/subjects/services/credentialAsk';
import { END_SESSIONS_NEEDS_MANAGE_SESSIONS } from '@odudu/contracts/admin';
import { COULD_NOT_FINISH, failureTextWith } from '#/shared/services/failure';
import { counted } from '#/shared/services/format';
import type { GatewayFailure } from '#/shared/services/result';
import { subjectRefusal } from '#/features/subjects/services/access';
import { factorLabel } from '#/features/subjects/services/credentialList';

export function credentialDoneText(name: string, asking: AskedChange): string {
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
  return failureTextWith({
    network: () =>
      `Could not confirm the result. ${what} has not been sent again; the tab shows what the server holds now.`,
    schema: () =>
      `${what} may have happened, but the answer could not be read. The tab shows what the server holds now.`,
    defect: () => COULD_NOT_FINISH,
    problem: ({ status, detail, title }) => {
      if (status !== 403) return `Refused: ${detail ?? title}`;
      // The one refusal that is the caller's own: ending sessions needs a
      // capability the removal itself does not.
      const needs =
        detail === END_SESSIONS_NEEDS_MANAGE_SESSIONS ? 'manage-sessions' : 'manage-users';
      return `Refused: ${subjectRefusal('the subject', needs)}`;
    },
  })(failure);
}

export function recoveryCodesText(name: string, count: number | null): string {
  if (count === null || count === 0) return `No recovery codes: ${name} holds no unspent one.`;
  return counted(count, 'unspent recovery code', 'unspent recovery codes');
}
