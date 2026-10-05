import { useState } from 'react';
import { useAuthority, useRefusal } from '#/features/session';
import { useCreateSubject } from '#/features/subjects/repository/useCreateSubject.ts';
import { useGo } from '#/features/subjects/repository/useGo.ts';
import {
  newSubjectSpec,
  subjectCreatedText,
  subjectHref,
  subjectsHref,
  USERNAME_RULE_TEXT,
  usernameProblem,
} from '#/features/subjects/service.ts';
import { useToasts } from '#/shared/repository/useToasts.ts';
import { notLacking } from '#/shared/service/access.ts';
import { createFailure, lookupText } from '#/shared/service/failure.ts';
import { withoutField } from '#/shared/service/fieldErrors.ts';
import type { GatewayFailure } from '#/shared/transport/gateway.ts';

export interface NewSubject {
  // Why creating would be refused, named before anything is sent.
  refused: 'manage-users' | null;
  rule: string;
  listHref: string;
  username: string;
  email: string;
  usernameError: string | undefined;
  emailError: string | undefined;
  message: string | null;
  // The POST's answer was lost: offer to look for the subject rather than send it again.
  unconfirmed: boolean;
  busy: boolean;
  editUsername: (username: string) => void;
  editEmail: (email: string) => void;
  submit: () => void;
  check: () => void;
}

interface Errors {
  username?: string;
  email?: string;
}

export function useNewSubject(tenant: string): NewSubject {
  const authority = useAuthority(tenant);
  const refusal = useRefusal(tenant);
  const creation = useCreateSubject(tenant);
  const go = useGo();
  const push = useToasts((queue) => queue.push);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);

  const land = (id: string, name: string): void => {
    push({ tone: 'success', message: subjectCreatedText(name) });
    go(subjectHref(tenant, id), { replace: true });
  };

  const failed = (name: string, failure: GatewayFailure): void => {
    const outcome = createFailure(failure, newSubjectSpec(name));
    if (outcome.unconfirmed) setUnconfirmed(true);
    if (outcome.report) refusal.report(failure, 'manage-users');
    setErrors(outcome.errors);
    setMessage(outcome.message);
  };

  const looked = lookupText('subject', username);

  return {
    refused: notLacking(authority, ['manage-users']) ? null : 'manage-users',
    rule: USERNAME_RULE_TEXT,
    listHref: subjectsHref(tenant),
    username,
    email,
    usernameError: errors.username,
    emailError: errors.email,
    message,
    unconfirmed,
    busy: creation.busy,
    editUsername: (next) => {
      setUsername(next);
      setErrors((was) => withoutField(was, 'username'));
    },
    editEmail: (next) => {
      setEmail(next);
      setErrors((was) => withoutField(was, 'email'));
    },
    submit: () => {
      if (creation.busy || unconfirmed) return;
      const problem = usernameProblem(username);
      if (problem !== null) {
        setErrors({ username: problem });
        return;
      }
      setErrors({});
      setMessage(null);
      creation
        .create({ username, email })
        .then((result) => {
          if (result.ok) land(result.data.id, username);
          else failed(username, result);
        })
        .catch(() => {
          failed(username, { ok: false, kind: 'defect' });
        });
    },
    check: () => {
      if (creation.busy) return;
      creation
        .find(username)
        .then((result) => {
          if (!result.ok) {
            setMessage(looked.failed);
            return;
          }
          if (result.data !== null) {
            land(result.data.id, username);
            return;
          }
          setUnconfirmed(false);
          setMessage(looked.missing);
        })
        .catch(() => {
          setMessage(looked.failed);
        });
    },
  };
}
