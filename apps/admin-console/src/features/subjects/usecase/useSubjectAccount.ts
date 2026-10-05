import type { Subject } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useEndOwnSession, useRefusal } from '#/features/session';
import { areaAt, areaHref } from '#/features/shell';
import { useGo } from '#/features/subjects/repository/useGo.ts';
import {
  saveAccount,
  useSubjectDeletion,
  useSubjectEnabled,
  useUsernamePolicy,
  type AccountValues,
} from '#/features/subjects/repository/useSubjectRecord.ts';
import {
  enabledVerb,
  subjectName,
  subjectRecord,
  subjectsHref,
  subjectWriteFailure,
  usernameMode,
  type UsernameMode,
} from '#/features/subjects/service';
import { useSectionSave, type SectionSave } from '#/shared/repository/useSectionSave.ts';
import { useToasts } from '#/shared/repository/useToasts.ts';
import { deletedText, enabledText } from '#/shared/service/failure.ts';

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
  const push = useToasts((queue) => queue.push);
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
    onRefused: (failure) => {
      refusal.report(failure, 'manage-users');
    },
    fields: {
      username: { value: subject.username ?? '', label: 'Username', kind: 'plain' },
      email: { value: subject.email ?? '', label: 'Email', kind: 'plain' },
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
          push({ tone: 'success', message: enabledText(name, next) });
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

  const confirmable = (which: 'disable' | 'delete', confirm: () => void, busy: boolean) => ({
    confirming: confirming === which,
    busy,
    problem: confirming === which ? problem : null,
    ask: () => {
      setProblem(null);
      setConfirming(which);
    },
    cancel: () => {
      setProblem(null);
      setConfirming(null);
    },
    confirm,
  });

  return {
    name,
    section,
    username,
    enabled: subject.enabled,
    enable: () => {
      setEnabled(true);
    },
    disable: confirmable(
      'disable',
      () => {
        setEnabled(false);
      },
      enabledChange.busy,
    ),
    enabledMessage,
    remove: confirmable(
      'delete',
      () => {
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
              push({ tone: 'success', message: deletedText(name) });
              go(subjectsHref(tenant), { replace: true });
              return;
            }
            refusal.report(result, 'manage-users');
            setProblem(subjectWriteFailure(result, name, 'deleted'));
          })
          .catch(() => {
            setProblem(subjectWriteFailure({ ok: false, kind: 'defect' }, name, 'deleted'));
          });
      },
      deletion.busy,
    ),
  };
}
