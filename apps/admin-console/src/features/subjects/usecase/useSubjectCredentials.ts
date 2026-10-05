import type { ListCredentialsResponse, Lockout, Subject } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useRefusal } from '#/features/session';
import {
  useCredentialChanges,
  useCredentials,
  useIssuePassword,
  useLockout,
  type Read,
} from '#/features/subjects/repository/useCredentials.ts';
import {
  credentialChangeOf,
  credentialDialogOf,
  credentialDoneText,
  credentialFailureText,
  signsInAsItself,
  subjectName,
  type Asking,
  type CredentialDialog,
} from '#/features/subjects/service.ts';
import { useToasts } from '#/shared/repository/useToasts.ts';

export type { Asking };

export interface SubjectCredentials {
  name: string;
  // A service or agent subject, which holds none of this.
  itself: boolean;
  credentials: Read<ListCredentialsResponse>;
  lockout: Read<Lockout>;
  asking: Asking | null;
  // What the confirmation says for the change being asked.
  dialog: CredentialDialog | null;
  busy: boolean;
  problem: string | null;
  ask: (asking: Asking) => void;
  cancel: () => void;
  confirm: () => void;
  // The one-time password, for its SecretDialog and nothing else.
  secret: string | null;
  closeSecret: () => void;
}

export function useSubjectCredentials(
  tenant: string,
  subject: Subject,
  self: boolean,
): SubjectCredentials {
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
      setProblem(credentialFailureText('The password', failure));
    },
  });

  return {
    name,
    itself,
    credentials,
    lockout,
    asking,
    dialog: credentialDialogOf(asking, name, self),
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
      const change = credentialChangeOf(asking);
      if (change === null) return;
      changes
        .run(change)
        .then((result) => {
          if (result.ok) {
            setAsking(null);
            push({ tone: 'success', message: credentialDoneText(name, asking) });
            return;
          }
          refusal.report(result, 'manage-users');
          setProblem(credentialFailureText('The change', result));
        })
        .catch(() => {
          setProblem(credentialFailureText('The change', { ok: false, kind: 'defect' }));
        });
    },
    secret: issue.secret,
    closeSecret: issue.close,
  };
}
