import type { RequiredAction, Subject } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useRefusal } from '#/features/session';
import { areaAt, areaHref } from '#/features/shell';
import { useMailSend, type MailRequest } from '#/features/subjects/repository/useMail.ts';
import {
  actionsMailProblem,
  mailFailure,
  mailOutcome,
  mailSentText,
  requiredActionsInOrder,
  subjectName,
  subjectTabHref,
  type MailOutcome,
} from '#/features/subjects/service.ts';
import { withoutField } from '#/shared/service/fieldErrors.ts';

export type { MailOutcome };

export interface Mail {
  busy: boolean;
  outcome: MailOutcome | null;
  send: () => void;
}

export interface ActionsMail extends Mail {
  actions: readonly RequiredAction[];
  errors: Readonly<Partial<Record<'actions', string>>>;
  choose: (actions: readonly string[]) => void;
}

export interface SubjectMail {
  // Only an address the subject has can be mailed: without one, none is offered.
  email: string | null;
  reset: Mail;
  verification: Mail;
  actions: ActionsMail;
}

type Kind = MailRequest['kind'];

export function useSubjectMail(tenant: string, subject: Subject): SubjectMail {
  const name = subjectName(subject);
  const refusal = useRefusal(tenant);
  const mail = useMailSend(tenant, subject.id);
  const [running, setRunning] = useState<Kind | null>(null);
  const [outcomes, setOutcomes] = useState<Partial<Record<Kind, MailOutcome>>>({});
  const [actions, setActions] = useState<readonly RequiredAction[]>([]);
  const [errors, setErrors] = useState<ActionsMail['errors']>({});

  const fixHrefs = {
    profile: subjectTabHref(tenant, subject.id, 'profile'),
    email: areaHref(tenant, areaAt('email')),
    settings: areaHref(tenant, areaAt('settings')),
  };

  const run = (kind: Kind, request: MailRequest, sentText: string): void => {
    if (running !== null) return;
    setRunning(kind);
    setOutcomes((was) => withoutField(was, kind));
    mail
      .send(request)
      .then((result) => {
        if (result.ok) {
          setOutcomes((was) => ({ ...was, [kind]: { sent: true, text: sentText, fix: null } }));
          return;
        }
        refusal.report(result, 'manage-users');
        const failed = mailFailure(kind, result, name, fixHrefs);
        if (failed.errors !== null) setErrors(failed.errors);
        if (failed.outcome !== null) {
          const { outcome } = failed;
          setOutcomes((was) => ({ ...was, [kind]: outcome }));
        }
      })
      .catch(() => {
        setOutcomes((was) => ({
          ...was,
          [kind]: mailOutcome({ ok: false, kind: 'defect' }, name, fixHrefs),
        }));
      })
      .finally(() => {
        setRunning(null);
      });
  };

  return {
    email: subject.email,
    reset: {
      busy: running === 'reset',
      outcome: outcomes.reset ?? null,
      send: () => {
        run('reset', { kind: 'reset' }, mailSentText('reset', subject.email));
      },
    },
    verification: {
      busy: running === 'verification',
      outcome: outcomes.verification ?? null,
      send: () => {
        run('verification', { kind: 'verification' }, mailSentText('verification', subject.email));
      },
    },
    actions: {
      busy: running === 'actions',
      outcome: outcomes.actions ?? null,
      actions,
      errors,
      choose: (next) => {
        setErrors((was) => withoutField(was, 'actions'));
        setActions(requiredActionsInOrder(next));
      },
      send: () => {
        const problem = actionsMailProblem(actions);
        if (problem !== null) {
          setErrors(problem);
          return;
        }
        setErrors({});
        run(
          'actions',
          { kind: 'actions', body: { actions: [...actions] } },
          mailSentText('actions', subject.email, actions.length),
        );
      },
    },
  };
}
