import { writeFailureText } from '#/shared/lib/services/failure';
import type { GatewayFailure } from '#/shared/lib/services/result';
import { subjectRefusal } from '#/shared/lib/services/capabilities';
import { type Subject, type SubjectChanges } from '#/entities/subject';

// A service subject has no `users` row: no username, email,
// profile, password or lockout, since it signs in as itself.
export function signsInAsItself(subject: Pick<Subject, 'type'>): boolean {
  return subject.type !== 'user';
}

// Keyed on the subject's type alone: the server refuses on a client naming
// the subject, and every service subject the product makes has one.
export const SERVICE_ACCOUNT_DELETION =
  "This is a client's service account. Delete the client instead; it cannot be deleted on its own.";

export const AGENT_INSTANCE_DELETION =
  'This is an agent instance. Revoke an agent instance instead; the reaper deletes it after its retention window.';

export function deletionRefusal(subject: Pick<Subject, 'type'>): string | null {
  switch (subject.type) {
    case 'service':
      return SERVICE_ACCOUNT_DELETION;
    case 'agent_instance':
      return AGENT_INSTANCE_DELETION;
    case 'user':
      return null;
  }
}

export function enabledVerb(enabled: boolean): 'enabled' | 'disabled' {
  return enabled ? 'enabled' : 'disabled';
}

// A confirmation question shows only for the one asked; the problem a
// failed answer left belongs to it.
export function confirmationOf<W extends string>(
  which: W,
  asked: W | null,
  problem: string | null,
): { confirming: boolean; problem: string | null } {
  return asked === which ? { confirming: true, problem } : { confirming: false, problem: null };
}

export function subjectWriteFailure(failure: GatewayFailure, name: string, verb: string): string {
  return writeFailureText(failure, {
    name,
    verb,
    lookAt: 'the subject',
    stale: `${name} changed elsewhere since you opened it, so it was not ${verb}. It has been read again; look at it before trying again.`,
    refused: (problem) =>
      problem.status === 403
        ? `${name} was not ${verb}: ${subjectRefusal(name, 'manage-users')}`
        : null,
  });
}

export const ACCOUNT_DESCRIPTION =
  'How the subject signs in and is written to. A new email is mailed a link, and replaces the current one once the person follows it.';

export const CANCEL_PENDING_LABEL = 'Cancel the change';

export function pendingChangeText(address: string | null | undefined): string | null {
  return address === null || address === undefined
    ? null
    : `Change pending: ${address}. The current address stays until they confirm it.`;
}

// The server reads a PATCH with the current address as withdrawing a pending change.
export function cancelPendingChange(subject: Pick<Subject, 'email'>): SubjectChanges {
  return { email: subject.email };
}

export function pendingCancelFailure(failure: GatewayFailure, name: string): string {
  return subjectWriteFailure(failure, `The pending change for ${name}`, 'cancelled');
}
