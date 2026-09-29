import { useState } from 'react';
import { useAuthority, useRefusal } from '#/features/session/index.ts';
import { holds } from '#/features/shell/index.ts';
import { useCreateSubject } from '#/features/subjects/repository/useCreateSubject.ts';
import { useGo } from '#/features/subjects/repository/useGo.ts';
import {
  subjectHref,
  subjectsHref,
  USERNAME_RULE_TEXT,
  usernameProblem,
} from '#/features/subjects/service.ts';
import { useToasts } from '#/shared/repository/useToasts.ts';
import { fieldErrorsOf } from '#/shared/service/fieldErrors.ts';
import type { GatewayFailure } from '#/shared/transport/gateway.ts';

export interface NewSubject {
  // Why creating would be refused, named before anything is sent.
  readonly refused: 'manage-users' | null;
  readonly rule: string;
  readonly listHref: string;
  readonly username: string;
  readonly email: string;
  readonly usernameError: string | undefined;
  readonly emailError: string | undefined;
  readonly message: string | null;
  // The POST's answer was lost: offer to look for the subject rather than send it again.
  readonly unconfirmed: boolean;
  readonly busy: boolean;
  readonly editUsername: (username: string) => void;
  readonly editEmail: (email: string) => void;
  readonly submit: () => void;
  readonly check: () => void;
}

interface Errors {
  readonly username?: string;
  readonly email?: string;
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
    push({
      tone: 'success',
      message: `${name} was created. It has no password yet: issue a one-time password from its Credentials tab.`,
    });
    go(subjectHref(tenant, id), { replace: true });
  };

  const failed = (name: string, failure: GatewayFailure): void => {
    switch (failure.kind) {
      case 'network':
        setUnconfirmed(true);
        setMessage(
          `Could not confirm whether ${name} was created. It has not been sent again; look for it before trying again.`,
        );
        return;
      case 'schema':
        setUnconfirmed(true);
        setMessage(`${name} may have been created, but the answer could not be read. Look for it.`);
        return;
      case 'defect':
        setMessage(
          'The console could not create the subject. This is a fault in the console, not something you did.',
        );
        return;
      case 'problem': {
        if (failure.problem.status === 403) {
          refusal.report(failure, 'manage-users');
          setMessage(`${name} was not created: it needs the manage-users capability.`);
          return;
        }
        const placed = fieldErrorsOf(failure.problem, ['username', 'email']);
        setErrors(placed.fields);
        setMessage(placed.other.length === 0 ? null : placed.other.join(' '));
      }
    }
  };

  return {
    refused: authority !== undefined && !holds(authority, 'manage-users') ? 'manage-users' : null,
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
      setErrors((was) => ({ ...(was.email === undefined ? {} : { email: was.email }) }));
    },
    editEmail: (next) => {
      setEmail(next);
      setErrors((was) => ({ ...(was.username === undefined ? {} : { username: was.username }) }));
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
            setMessage(`Could not look for ${username}. Try again.`);
            return;
          }
          if (result.data !== null) {
            land(result.data.id, username);
            return;
          }
          setUnconfirmed(false);
          setMessage(
            `No subject named ${username} was found, so it was not created. Creating it again is safe.`,
          );
        })
        .catch(() => {
          setMessage(`Could not look for ${username}. Try again.`);
        });
    },
  };
}
