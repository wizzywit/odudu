import type { RequiredAction, Subject } from '@odudu/contracts/admin';
import { useState } from 'react';
import { useRefusal } from '#/features/session/index.ts';
import { areaAt, areaHref } from '#/features/shell/index.ts';
import { useMailSend, type MailRequest } from '#/features/subjects/repository/useMail.ts';
import {
  mailRefusal,
  REQUIRED_ACTIONS,
  subjectName,
  subjectTabHref,
} from '#/features/subjects/service.ts';
import { fieldErrorsOf } from '#/shared/service/fieldErrors.ts';
import type { GatewayFailure } from '#/shared/transport/gateway.ts';

export interface MailOutcome {
  sent: boolean;
  text: string;
  // Where the refusal is put right, when it is a fact about the tenant or subject.
  fix: { label: string; href: string } | null;
}

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

function inOrder(actions: readonly string[]): RequiredAction[] {
  return REQUIRED_ACTIONS.map((each) => each.action).filter((action) => actions.includes(action));
}

export function useSubjectMail(tenant: string, subject: Subject): SubjectMail {
  const name = subjectName(subject);
  const refusal = useRefusal(tenant);
  const mail = useMailSend(tenant, subject.id);
  const [running, setRunning] = useState<Kind | null>(null);
  const [outcomes, setOutcomes] = useState<Partial<Record<Kind, MailOutcome>>>({});
  const [actions, setActions] = useState<readonly RequiredAction[]>([]);
  const [errors, setErrors] = useState<ActionsMail['errors']>({});
  const clear = (field: keyof ActionsMail['errors']): void => {
    setErrors((was) => Object.fromEntries(Object.entries(was).filter(([key]) => key !== field)));
  };

  const fixOf = (fix: 'profile' | 'email' | 'settings'): MailOutcome['fix'] => {
    switch (fix) {
      case 'profile':
        return { label: 'Profile', href: subjectTabHref(tenant, subject.id, 'profile') };
      case 'email':
        return { label: 'Email', href: areaHref(tenant, areaAt('email')) };
      case 'settings':
        return { label: 'Settings', href: areaHref(tenant, areaAt('settings')) };
    }
  };

  const refused = (failure: GatewayFailure): MailOutcome => {
    switch (failure.kind) {
      case 'network':
        return {
          sent: false,
          text: 'Could not confirm the mail was sent. It has not been asked for again; nothing shows whether it went, so ask again only if it is still owed.',
          fix: null,
        };
      case 'schema':
        return {
          sent: true,
          text: 'The mail was asked for, but the answer could not be read.',
          fix: null,
        };
      case 'defect':
        return {
          sent: false,
          text: 'The console could not finish. This is a fault in the console, not something you did.',
          fix: null,
        };
      case 'problem': {
        const said = mailRefusal(failure.problem.type, name);
        if (said !== null) return { sent: false, text: said.text, fix: fixOf(said.fix) };
        if (failure.problem.status === 403) {
          return {
            sent: false,
            text: `Refused: it needs the manage-users capability, or ${name} holds an admin capability you do not.`,
            fix: null,
          };
        }
        return {
          sent: false,
          text: `Not sent: ${failure.problem.detail ?? failure.problem.title}`,
          fix: null,
        };
      }
    }
  };

  const run = (kind: Kind, request: MailRequest, sentText: string): void => {
    if (running !== null) return;
    setRunning(kind);
    setOutcomes((was) => Object.fromEntries(Object.entries(was).filter(([key]) => key !== kind)));
    mail
      .send(request)
      .then((result) => {
        if (result.ok) {
          setOutcomes((was) => ({ ...was, [kind]: { sent: true, text: sentText, fix: null } }));
          return;
        }
        refusal.report(result, 'manage-users');
        if (kind === 'actions' && result.kind === 'problem' && result.problem.status === 400) {
          const placed = fieldErrorsOf(result.problem, ['actions']);
          setErrors(placed.fields);
          if (placed.other.length === 0) return;
        }
        setOutcomes((was) => ({ ...was, [kind]: refused(result) }));
      })
      .catch(() => {
        setOutcomes((was) => ({ ...was, [kind]: refused({ ok: false, kind: 'defect' }) }));
      })
      .finally(() => {
        setRunning(null);
      });
  };

  const address = subject.email ?? 'their address';
  return {
    email: subject.email,
    reset: {
      busy: running === 'reset',
      outcome: outcomes.reset ?? null,
      send: () => {
        run('reset', { kind: 'reset' }, `A password reset link was sent to ${address}.`);
      },
    },
    verification: {
      busy: running === 'verification',
      outcome: outcomes.verification ?? null,
      send: () => {
        run(
          'verification',
          { kind: 'verification' },
          `A verification link was sent to ${address}.`,
        );
      },
    },
    actions: {
      busy: running === 'actions',
      outcome: outcomes.actions ?? null,
      actions,
      errors,
      choose: (next) => {
        clear('actions');
        setActions(inOrder(next));
      },
      send: () => {
        if (actions.length === 0) {
          setErrors({ actions: 'Choose at least one action.' });
          return;
        }
        setErrors({});
        const count = actions.length === 1 ? '1 action' : `${String(actions.length)} actions`;
        run(
          'actions',
          { kind: 'actions', body: { actions: [...actions] } },
          `A link through ${count} was sent to ${address}. Following it asks for each, in order.`,
        );
      },
    },
  };
}
