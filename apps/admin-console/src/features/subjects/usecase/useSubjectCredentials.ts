import type { Credential, ListCredentialsResponse, Lockout, Subject } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useRefusal } from '#/features/session/index.ts';
import {
  useCredentialChanges,
  useCredentials,
  useIssuePassword,
  useLockout,
  type CredentialChange,
  type Read,
} from '#/features/subjects/repository/useCredentials.ts';
import { factorLabel, signsInAsItself, subjectName } from '#/features/subjects/service.ts';
import { useToasts } from '#/shared/repository/useToasts.ts';
import type { GatewayResult } from '#/shared/transport/gateway.ts';

export type Asking =
  | { readonly kind: 'password' }
  | { readonly kind: 'factor'; readonly credential: Credential }
  | { readonly kind: 'recovery-codes' }
  | { readonly kind: 'lockout' };

export interface SubjectCredentials {
  readonly name: string;
  // A service or agent subject, which holds none of this.
  readonly itself: boolean;
  readonly credentials: Read<ListCredentialsResponse>;
  readonly lockout: Read<Lockout>;
  readonly asking: Asking | null;
  readonly busy: boolean;
  readonly problem: string | null;
  readonly ask: (asking: Asking) => void;
  readonly cancel: () => void;
  readonly confirm: () => void;
  // The one-time password, for its SecretDialog and nothing else.
  readonly secret: string | null;
  readonly closeSecret: () => void;
}

function refusalText(what: string, result: Exclude<GatewayResult<unknown>, { ok: true }>): string {
  switch (result.kind) {
    case 'network':
      return `Could not confirm the result. ${what} has not been sent again; the tab shows what the server holds now.`;
    case 'schema':
      return `${what} may have happened, but the answer could not be read. The tab shows what the server holds now.`;
    case 'defect':
      return `The console could not finish. This is a fault in the console, not something you did.`;
    case 'problem':
      if (result.problem.status === 403) {
        return 'Refused: it needs the manage-users capability, or the subject holds an admin capability you do not.';
      }
      return `Refused: ${result.problem.detail ?? result.problem.title}`;
  }
}

function changeOf(asking: Exclude<Asking, { kind: 'password' }>): CredentialChange | null {
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

function doneText(name: string, asking: Exclude<Asking, { kind: 'password' }>): string {
  switch (asking.kind) {
    case 'factor':
      return `${factorLabel(asking.credential.type)} removed from ${name}.`;
    case 'recovery-codes':
      return `${name}'s recovery codes are revoked.`;
    case 'lockout':
      return `${name}'s lockout is cleared.`;
  }
}

export function useSubjectCredentials(tenant: string, subject: Subject): SubjectCredentials {
  const itself = signsInAsItself(subject);
  const name = subjectName(subject);
  const refusal = useRefusal(tenant);
  const push = useToasts((queue) => queue.push);
  const credentials = useCredentials(tenant, subject.id, !itself);
  const lockout = useLockout(tenant, subject.id, !itself);
  const changes = useCredentialChanges(tenant, subject.id);
  const [asking, setAsking] = useState<Asking | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // The issue's failure is said in the dialog that asked for it; its
  // success closes that dialog, and the secret has its own.
  const issue = useIssuePassword(tenant, subject.id, {
    issued: () => {
      setAsking(null);
    },
    refused: (failure) => {
      refusal.report(failure, 'manage-users');
      setProblem(refusalText('The password', failure));
    },
  });

  return {
    name,
    itself,
    credentials,
    lockout,
    asking,
    busy: changes.busy || issue.busy,
    problem,
    ask: (next) => {
      setProblem(null);
      setAsking(next);
    },
    cancel: () => {
      setProblem(null);
      setAsking(null);
    },
    confirm: () => {
      if (asking === null || changes.busy || issue.busy) return;
      setProblem(null);
      if (asking.kind === 'password') {
        issue.start();
        return;
      }
      const change = changeOf(asking);
      if (change === null) return;
      changes
        .run(change)
        .then((result) => {
          if (result.ok) {
            setAsking(null);
            push({ tone: 'success', message: doneText(name, asking) });
            return;
          }
          refusal.report(result, 'manage-users');
          setProblem(refusalText('The change', result));
        })
        .catch(() => {
          setProblem(refusalText('The change', { ok: false, kind: 'defect' }));
        });
    },
    secret: issue.secret,
    closeSecret: issue.close,
  };
}
