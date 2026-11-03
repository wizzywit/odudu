import { useState } from 'react';
import { useEndOwnSession, useRefusal } from '#/entities/session';
import { areaAt, areaHref } from '#/entities/area';
import { useGo } from '#/shared/repository/useGo';
import {
  saveAccount,
  useSubjectDeletion,
  useSubjectEnabled,
  useUsernamePolicy,
  type AccountValues,
} from '#/pages/subjects/repository/useSubjectRecord';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave';
import { useToast } from '#/shared/repository/useToasts';
import { deletedText, enabledText } from '#/shared/services/failure';
import { orBlank } from '#/shared/services/format';
import { DESCRIPTION_RULE } from '#/shared/services/labels';
import {
  confirmationOf,
  deletionRefusal,
  enabledVerb,
  signsInAsItself,
  subjectWriteFailure,
} from '#/pages/subjects/services/subjectAccount';
import { usernameMode, type UsernameMode } from '#/pages/subjects/services/username';
import { type Subject, subjectName, subjectsHref, subjectRecord } from '#/entities/subject';

export type { UsernameMode };

export interface Confirmable {
  confirming: boolean;
  busy: boolean;
  // The server's refusal, said in the dialog that asked for it.
  problem: string | null;
  ask: () => void;
  cancel: () => void;
  confirm: () => void;
}

export interface SubjectAccount {
  name: string;
  // A service subject has no username, email or profile.
  itself: boolean;
  // What is said under the email field.
  descriptionRule: string;
  // Why the subject cannot be deleted here, when it cannot.
  deletionRefusal: string | null;
  section: SectionSave<AccountValues>;
  username: UsernameMode;
  enabled: boolean;
  // Enabling has an inverse, so it asks nothing; disabling asks first.
  enable: () => void;
  disable: Confirmable;
  // Why the last enable did not happen, said beside the button.
  enabledMessage: string | null;
  remove: Confirmable;
}

export function useSubjectAccount(
  tenant: string,
  subject: Subject,
  etag: string,
  gone: boolean,
  // Whether this is the subject signed in, whose delete ends the session.
  self: boolean,
): SubjectAccount {
  const refusal = useRefusal(tenant);
  const toast = useToast();
  const go = useGo();
  const name = subjectName(subject);
  const section = useSectionSave({
    tenant,
    record: subjectRecord(subject.id),
    section: 'account',
    label: 'Account',
    etag,
    capability: 'manage-users',
    gone,
    refusal,
    fields: {
      username: { value: orBlank(subject.username), label: 'Username', kind: 'plain' },
      email: { value: orBlank(subject.email), label: 'Email', kind: 'plain' },
    },
    save: saveAccount(tenant, subject.id),
  });
  const username = usernameMode(useUsernamePolicy(tenant), areaHref(tenant, areaAt('settings')));
  const enabledChange = useSubjectEnabled(tenant, subject.id, etag);
  const deletion = useSubjectDeletion(tenant, subject.id);
  const endOwnSession = useEndOwnSession();
  const [confirming, setConfirming] = useState<'disable' | 'delete' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [enabledMessage, setEnabledMessage] = useState<string | null>(null);

  const setEnabled = (next: boolean): void => {
    if (enabledChange.busy) return;
    setProblem(null);
    setEnabledMessage(null);
    const verb = enabledVerb(next);
    enabledChange
      .run(next)
      .then((result) => {
        if (result.ok) {
          setConfirming(null);
          toast.succeeded(enabledText(name, next));
          return;
        }
        refusal.report(result, 'manage-users');
        if (next) setEnabledMessage(subjectWriteFailure(result, name, verb));
        else setProblem(subjectWriteFailure(result, name, verb));
      })
      .catch(() => {
        setProblem(subjectWriteFailure({ ok: false, kind: 'defect' }, name, verb));
      });
  };

  const ask = (which: 'disable' | 'delete'): void => {
    setProblem(null);
    setConfirming(which);
  };
  const cancel = (): void => {
    setProblem(null);
    setConfirming(null);
  };
  const disable = (): void => {
    setEnabled(false);
  };
  const remove = (): void => {
    if (deletion.busy) return;
    setProblem(null);
    deletion
      .run()
      .then((result) => {
        if (result.ok && self) {
          endOwnSession().catch(() => undefined);
          return;
        }
        if (result.ok) {
          setConfirming(null);
          toast.succeeded(deletedText(name));
          go(subjectsHref(tenant), { replace: true });
          return;
        }
        refusal.report(result, 'manage-users');
        setProblem(subjectWriteFailure(result, name, 'deleted'));
      })
      .catch(() => {
        setProblem(subjectWriteFailure({ ok: false, kind: 'defect' }, name, 'deleted'));
      });
  };
  return {
    name,
    itself: signsInAsItself(subject),
    descriptionRule: DESCRIPTION_RULE,
    deletionRefusal: deletionRefusal(subject),
    section,
    username,
    enabled: subject.enabled,
    enable: () => {
      setEnabled(true);
    },
    disable: {
      ...confirmationOf('disable', confirming, problem),
      busy: enabledChange.busy,
      ask: () => {
        ask('disable');
      },
      cancel,
      confirm: disable,
    },
    enabledMessage,
    remove: {
      ...confirmationOf('delete', confirming, problem),
      busy: deletion.busy,
      ask: () => {
        ask('delete');
      },
      cancel,
      confirm: remove,
    },
  };
}
