import type { ListCredentialsResponse, Lockout, Subject } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useRefusal } from '#/entities/session';
import {
  useCredentialChanges,
  useCredentials,
  useIssuePassword,
  useRefreshCredentials,
  useLockout,
} from '#/features/subjects/repository/useCredentials';
import { subjectName } from '#/features/subjects/services/address';
import { useToast } from '#/shared/repository/useToasts';
import type { NamedDialog } from '#/shared/services/dialog';
import type { Read } from '#/shared/services/read';
import {
  askingAgainst,
  credentialDialogOf,
  type Asking,
} from '#/features/subjects/services/credentialAsk';
import {
  CHOICE_DEFAULTS,
  choiceControl,
  type ChoiceControl,
} from '#/features/subjects/services/credentialChoices';
import { credentialChangeOf } from '#/features/subjects/services/credentialChange';
import {
  credentialDoneText,
  credentialFailureText,
} from '#/features/subjects/services/credentialOutcome';
import { signsInAsItself } from '#/features/subjects/services/subjectAccount';

export type { Asking };

export interface SubjectCredentials {
  name: string;
  // A service subject, which holds none of this.
  itself: boolean;
  credentials: Read<ListCredentialsResponse>;
  lockout: Read<Lockout>;
  asking: Asking | null;
  // The choice the confirmation offers, when it offers one.
  choice: ChoiceControl | null;
  // What the confirmation says for the change being asked.
  dialog: NamedDialog | null;
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
  const toast = useToast();
  const credentials = useCredentials(tenant, subject.id, !itself);
  const lockout = useLockout(tenant, subject.id, !itself);
  const changes = useCredentialChanges(tenant, subject.id);
  const [asked, setAsking] = useState<Asking | null>(null);
  const refreshCredentials = useRefreshCredentials(tenant, subject.id);
  const asking = askingAgainst(asked, credentials);
  const [choices, setChoices] = useState(CHOICE_DEFAULTS);
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
    choice: choiceControl(asking, choices, setChoices),
    dialog: credentialDialogOf(asking, name, self),
    busy: changes.busy || issue.busy,
    problem,
    ask: (next) => {
      setProblem(null);
      setChoices(CHOICE_DEFAULTS);
      refreshCredentials();
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
      const change = credentialChangeOf(asking, choices);
      if (change === null) return;
      changes
        .run(change)
        .then((result) => {
          if (result.ok) {
            setAsking(null);
            toast.succeeded(credentialDoneText(name, asking));
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
